"""Is the room cooling (or warming) faster than it should, from which side, and is it past its limits?

Built for one reading per second without doing heavy work per reading:

    every reading   add each good value to the current 10-second block      (a few additions)
    every 10 s      close the block, fit the slope over the last 10 minutes,
                    compare with what the room normally does, decide        (~60 numbers)
    every minute    store one learning row and write metrics
    every 5 min     re-learn the room from up to 6 hours of learning rows   (~360 rows, 3 numbers)

What "normal" means is learned per device:

    expected rate = g * (outside - room) + h * (heater - room) + c

g is how leaky the room is, h how strongly the heater warms it, c everything constant
(including the outside temperature when nothing tells us what it is). The difference
between the measured and the expected rate is the "surprise"; an open window shows up as a
surprise the model can't explain. Until enough is learned (1 hour), only simple fixed rules apply.

All times come from the readings, so the demo's fast simulated clock works the same as real time.
"""

import math
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from src.sentinel.analysis.base import AnalysisResult, Analyzer
from src.sentinel.analysis.stats import least_squares, line_fit, median, robust_sigma
from src.sentinel.models import Finding, Metric, Reading, Severity
from src.sentinel.profiles import PROFILES, Profile, Profiles

BLOCK_SECONDS=10
BLOCK_MIN_READINGS=7  # of 10; otherwise that sensor's block counts as missing
WINDOW_BLOCKS=60  # 10 minutes for the slope
WINDOW_MIN_VALID=36  # need 60% of the window
GAP_RESET_SECONDS=30  # a longer gap in the data restarts the windows
LEARN_EVERY=timedelta(minutes=1)
LEARN_ROWS_MAX=360  # 6 hours
LEARN_ROWS_MIN=60  # 1 hour before the model is trusted
REFIT_EVERY=timedelta(minutes=5)
ALARM_EVALS=12  # 2 minutes of 10-s evaluations in a row
CLEAR_EVALS=30  # 5 minutes back to normal
SURPRISE_SIGMAS=3.0
SURPRISE_FLOOR=0.05  # °C/min; never alarm on smaller surprises
FALLBACK_RATE=0.15  # °C/min; the fixed rule before the model is ready
SLOPE_SIGNIFICANCE=3.0  # slope must be this many standard errors from zero
DISTURB_JUMP=1.0  # °C between two blocks on one probe...
DISTURB_CALM=0.2  # ...while every other probe moves less than this
DISTURB_HOLD=timedelta(minutes=3)
SIDE_MIN_SHIFT=0.5  # °C a sensor's gap to the room must have changed to name a side
SIDE_MARGIN=0.3  # and by this much more than the next sensor
GAP_AVERAGING_BLOCKS=720  # the "normal" gap follows over about 2 hours
LIMIT_MARGIN=0.3  # °C back inside the limit before "too cold/warm" clears
HEATER_IDLE_GAP=2.0  # °C: heater probe this close to the room means the heater isn't running
HEATER_NEAR_LIMIT=0.5  # °C below the heater's usual switch-on temperature before "it should be running"
HEATER_OFF_EVALS=36  # 6 minutes of that with an idle heater
METRICS_EVERY=timedelta(minutes=1)
FORECAST_MAX_MINUTES=120  # further out is too uncertain to show
FORECAST_CRITICAL_MINUTES=15
TREND_EVALS=12  # rooms without a heater: a steady trend for 2 minutes before forecasting
FORECAST_BLOCKS=18  # the forecast uses the speed over the last 3 minutes


@dataclass
class Model:
    g: float
    h: float
    c: float
    sigma: float  # normal spread of the surprise, °C/min
    uses_heater: bool
    rows: int

    def expected(self, room: float, outside: float, source: float | None) -> float:
        heater=self.h*(source-room) if self.uses_heater and source is not None else 0.0
        return self.g*(outside-room)+heater+self.c


@dataclass
class Block:
    time: datetime
    temps: dict[str,float | None]
    room: float | None
    source: float | None


@dataclass
class Streak:
    """Consecutive evaluations above/below a threshold, with hysteresis."""
    bad: int=0
    good: int=0
    active: bool=False

    def update(self, is_bad: bool, is_good: bool, on_after: int, off_after: int) -> None:
        self.bad=self.bad+1 if is_bad else 0
        self.good=self.good+1 if is_good else 0
        if not self.active and self.bad>=on_after:
            self.active=True
        elif self.active and self.good>=off_after:
            self.active=False


@dataclass
class DeviceState:
    block_index: int | None=None
    sums: dict[str,float]=field(default_factory=dict)
    counts: dict[str,int]=field(default_factory=dict)
    blocks: deque=field(default_factory=lambda: deque(maxlen=WINDOW_BLOCKS))
    learn: deque=field(default_factory=lambda: deque(maxlen=LEARN_ROWS_MAX))
    model: Model | None=None
    last_learn: datetime | None=None
    last_fit: datetime | None=None
    last_metrics: datetime | None=None
    last_time: datetime | None=None
    normal_gap: dict[str,float]=field(default_factory=dict)
    ambient_offset: dict[str,float]=field(default_factory=dict)
    heater_was_running: bool | None=None
    heater_seen_running: bool=False
    heater_starts: deque=field(default_factory=lambda: deque(maxlen=20))  # room °C when the heater switched on
    disturbed: dict[str,tuple[datetime,float]]=field(default_factory=dict)  # sensor -> (until, jump)
    rate: Streak=field(default_factory=Streak)
    direction: str="cold"  # of the current fast-change alarm
    side: str | None=None  # where it comes from, kept for the whole alarm once known
    cold: Streak=field(default_factory=Streak)
    warm: Streak=field(default_factory=Streak)
    heater_off: Streak=field(default_factory=Streak)
    trend: Streak=field(default_factory=Streak)  # steady significant change towards a limit
    forecast: dict | None=None  # {"minutes", "limit_c", "direction", "method"} when there is one
    findings: list[Finding]=field(default_factory=list)


class ThermalAnalyzer(Analyzer):
    name="thermal"

    def __init__(self, profiles: Profiles=PROFILES):
        self.profiles=profiles
        self._devices: dict[str,DeviceState]={}

    def analyze(self, reading: Reading) -> AnalysisResult:
        st=self._devices.setdefault(reading.device_id,DeviceState())
        if st.last_time is not None and (reading.time-st.last_time).total_seconds()>GAP_RESET_SECONDS:
            self._restart(st)
        st.last_time=reading.time

        metrics=[]
        index=int(reading.time.timestamp()//BLOCK_SECONDS)
        if st.block_index is not None and index!=st.block_index:
            metrics=self._close_block(reading.device_id,st)
        st.block_index=index
        for name,value in reading.sensors.items():
            if value.ok:
                st.sums[name]=st.sums.get(name,0.0)+value.temp_c
                st.counts[name]=st.counts.get(name,0)+1
        # The issue tracker resolves an issue as soon as it isn't reported, so repeat the
        # current findings on every reading, not only when they are re-evaluated.
        return AnalysisResult(list(st.findings),metrics)

    def model(self, device_id: str) -> Model | None:
        st=self._devices.get(device_id)
        return st.model if st else None

    # ---------------------------------------------------------------- blocks

    def _restart(self, st: DeviceState) -> None:
        """After a gap: start the windows again. What was learned about the room is kept."""
        st.block_index=None
        st.sums.clear()
        st.counts.clear()
        st.blocks.clear()
        st.disturbed.clear()
        st.rate,st.cold,st.warm,st.heater_off=Streak(),Streak(),Streak(),Streak()
        st.findings=[]

    def _close_block(self, device_id: str, st: DeviceState) -> list[Metric]:
        profile=self.profiles.get(device_id)
        time=datetime.fromtimestamp((st.block_index+1)*BLOCK_SECONDS,tz=st.last_time.tzinfo)
        temps={name:st.sums[name]/n if (n:=st.counts.get(name,0))>=BLOCK_MIN_READINGS else None
               for name in set(st.sums)|set(st.counts)}
        st.sums.clear()
        st.counts.clear()

        self._check_disturbance(st,profile,temps,time)
        usable={n:v for n,v in temps.items() if v is not None and n not in st.disturbed}
        room=self._room(st,profile,usable)
        source=usable.get(profile.source) if profile.source else None
        st.blocks.append(Block(time,temps,room,source))
        return self._evaluate(device_id,st,profile,time)

    def _room(self, st: DeviceState, profile: Profile, usable: dict[str,float]) -> float | None:
        """Median of the ambient probes, each corrected by its usual offset from the others, so the
        room value doesn't jump when one probe drops out (unplugged, or a hand on it)."""
        present=[n for n in profile.ambient if n in usable]
        if not present:
            return None
        if len(present)==len(profile.ambient):
            centre=median([usable[n] for n in present])
            for n in present:
                old=st.ambient_offset.get(n)
                offset=usable[n]-centre
                st.ambient_offset[n]=offset if old is None else old+(offset-old)/GAP_AVERAGING_BLOCKS
        return median([usable[n]-st.ambient_offset.get(n,0.0) for n in present])

    def _check_disturbance(self, st: DeviceState, profile: Profile, temps: dict, time: datetime) -> None:
        """A hand (or a hair dryer) on one probe: a sudden jump on it while the room stays calm."""
        for name,(until,_) in list(st.disturbed.items()):
            if time>=until:
                del st.disturbed[name]
        if not st.blocks:
            return
        previous=st.blocks[-1].temps
        jumps={n:temps[n]-previous[n] for n in temps if temps[n] is not None and previous.get(n) is not None}
        for name,jump in jumps.items():
            # A sudden drop at the window or door is exactly what we want to see, not a disturbance.
            suspicious=jump>DISTURB_JUMP or (jump<-DISTURB_JUMP and name not in profile.edges)
            # The heater probe moves on its own when the heater switches, so it doesn't count as "the room".
            others=[abs(j) for n,j in jumps.items() if n!=name and n!=profile.source]
            if suspicious and others and max(others)<DISTURB_CALM:
                st.disturbed[name]=(time+DISTURB_HOLD,jump)

    # ---------------------------------------------------------------- evaluation

    def _evaluate(self, device_id: str, st: DeviceState, profile: Profile, time: datetime) -> list[Metric]:
        points=[(b.time,b.room) for b in st.blocks if b.room is not None]
        if len(points)<WINDOW_MIN_VALID:
            st.findings=self._disturbance_findings(device_id,st)
            return []

        t0=points[0][0]
        fit=line_fit([(t-t0).total_seconds()/60 for t,_ in points],[r for _,r in points])
        slope,_,slope_se=fit
        recent=[r for _,r in points[-6:]]
        room_now=sum(recent)/len(recent)
        room_mean=sum(r for _,r in points)/len(points)
        sources=[b.source for b in st.blocks if b.source is not None]
        source_mean=sum(sources)/len(sources) if sources else None
        outside_known=self.profiles.outside(device_id)
        outside=outside_known if outside_known is not None else 0.0  # unknown: absorbed by c

        if not st.rate.active and (st.last_learn is None or time-st.last_learn>=LEARN_EVERY):
            st.learn.append((slope,room_mean,source_mean,outside))
            st.last_learn=time
        if len(st.learn)>=LEARN_ROWS_MIN and (st.last_fit is None or time-st.last_fit>=REFIT_EVERY):
            st.model=self._fit(st.learn) or st.model
            st.last_fit=time

        expected=st.model.expected(room_mean,outside,source_mean) if st.model else None
        surprise=slope-expected if expected is not None else None
        significant=abs(slope)>SLOPE_SIGNIFICANCE*slope_se
        direction=self._bad_direction(profile,slope,slope_se,surprise,st.model,significant)
        if direction is not None and not st.rate.active:
            st.direction=direction
        # Back to normal = no longer changing abnormally in the alarm's direction. The fast
        # recovery after closing a window counts as normal.
        sign=-1 if st.direction=="cold" else 1
        if surprise is not None:
            is_good=sign*surprise<st.model.sigma
        else:
            is_good=sign*slope<0.05
        st.rate.update(direction==st.direction,is_good,ALARM_EVALS,CLEAR_EVALS)
        if not st.rate.active:
            st.side=None

        if not st.rate.active:
            self._follow_normal_gaps(st,profile)
        self._update_limits(st,profile,room_now)
        self._update_heater(st,profile,room_now,slope,significant,source_mean)
        recent=points[-FORECAST_BLOCKS:]
        recent_fit=line_fit([(t-recent[0][0]).total_seconds()/60 for t,_ in recent],[r for _,r in recent]) \
            if len(recent)>=FORECAST_BLOCKS*2//3 else None
        rate_now=recent_fit[0] if recent_fit else slope  # speed over the last 3 minutes
        st.forecast=self._forecast(st,profile,room_now,slope,significant,rate_now)

        st.findings=self._findings(device_id,st,profile,rate_now,expected,surprise,room_now,source_mean,outside_known)
        return self._metrics(device_id,st,time,room_now,slope,expected,surprise)

    def _forecast(self, st, profile, room, slope, significant, rate_now) -> dict | None:
        """Minutes until the room crosses its limit, if it keeps doing what it does now.

        Only when something is actually wrong (abnormal change, heater off) or, for places without
        a heater, a steady trend: in a heated room the thermostat would otherwise "forecast" a
        drop on every cycle that never happens because the heater switches back on.

        Uses the speed over the last 3 minutes: the 10-minute slope still contains the calm
        before a window opened and would promise far too much time.
        """
        direction="cold" if slope<0 else "warm"
        limit=profile.min_c if direction=="cold" else profile.max_c
        st.trend.update(significant and profile.watches(direction) and limit is not None,
                        not significant,TREND_EVALS,TREND_EVALS)
        something_wrong=(st.rate.active and st.direction==direction) or (direction=="cold" and st.heater_off.active)
        steady_unheated=profile.source is None and st.trend.active
        if limit is None or not significant or not (something_wrong or steady_unheated):
            return None
        if (room<=limit) if direction=="cold" else (room>=limit):
            return None  # TOO_COLD / TOO_WARM covers it

        rate=rate_now if (rate_now<0)==(direction=="cold") else slope

        k=st.model.g+(st.model.h if st.model.uses_heater else 0.0) if st.model else 0.0
        if k>1e-4:
            # The room heads towards end = room + rate/k, getting slower as it gets closer
            # (time constant 1/k, learned from this room).
            end=room+rate/k
            if not ((end<limit) if direction=="cold" else (end>limit)):
                return None  # settles before it reaches the limit
            minutes,method=math.log((room-end)/(limit-end))/k,"physics"
        else:
            minutes,method=(limit-room)/rate,"trend"
        if not 0<minutes<=FORECAST_MAX_MINUTES:
            return None
        return {"minutes":minutes,"limit_c":limit,"direction":direction,"method":method}

    def _fit(self, rows) -> Model | None:
        with_heater=[r for r in rows if r[2] is not None]
        heater_spread=robust_sigma([r[2]-r[1] for r in with_heater]) if len(with_heater)>=LEARN_ROWS_MIN else 0.0
        use_heater=heater_spread>=0.5  # the heater must have cycled, or its effect can't be learned
        data=with_heater if use_heater else rows
        use_leak=True
        # A coefficient that comes out impossible (a room that gains heat from being warmer than
        # outside, a heater that cools) means the data can't pin it down yet: drop it and refit.
        for _ in range(3):
            columns=[lambda r:r[3]-r[1]] if use_leak else []
            columns+=[lambda r:r[2]-r[1]] if use_heater else []
            coef=least_squares([[col(r) for col in columns]+[1.0] for r in data],[r[0] for r in data])
            if coef is None:
                return None
            g=coef[0] if use_leak else 0.0
            h=coef[int(use_leak)] if use_heater else 0.0
            if use_leak and g<0:
                use_leak=False
            elif use_heater and h<0:
                use_heater=False
                data=rows
            else:
                break
        model=Model(g,h,coef[-1],0.0,use_heater,len(data))
        residuals=[r[0]-model.expected(r[1],r[3],r[2]) for r in data]
        model.sigma=max(robust_sigma(residuals),0.005)
        return model

    def _bad_direction(self, profile, slope, slope_se, surprise, model, significant) -> str | None:
        if model is not None and surprise is not None:
            threshold=max(SURPRISE_SIGMAS*model.sigma,SURPRISE_FLOOR,SLOPE_SIGNIFICANCE*slope_se)
            if profile.watches("cold") and surprise<-threshold and slope<0:
                return "cold"
            if profile.watches("warm") and surprise>threshold and slope>0:
                return "warm"
            return None
        if not significant:
            return None
        if profile.watches("cold") and slope<=-FALLBACK_RATE:
            return "cold"
        if profile.watches("warm") and slope>=FALLBACK_RATE:
            return "warm"
        return None

    def _follow_normal_gaps(self, st: DeviceState, profile: Profile) -> None:
        block=st.blocks[-1]
        if block.room is None:
            return
        for edge in profile.edges:
            value=block.temps.get(edge)
            if value is None or edge in st.disturbed:
                continue
            gap=value-block.room
            old=st.normal_gap.get(edge)
            st.normal_gap[edge]=gap if old is None else old+(gap-old)/GAP_AVERAGING_BLOCKS

    def _side(self, st: DeviceState, profile: Profile, direction: str) -> tuple[str | None,dict]:
        """Which edge sensor moved away from the room the most, compared with its normal gap."""
        shifts={}
        for edge in profile.edges:
            values=[b.temps.get(edge)-b.room for b in list(st.blocks)[-6:]
                    if b.temps.get(edge) is not None and b.room is not None]
            if values and edge in st.normal_gap and edge not in st.disturbed:
                shifts[edge]=sum(values)/len(values)-st.normal_gap[edge]
        sign=-1 if direction=="cold" else 1
        ranked=sorted(shifts.items(),key=lambda kv:sign*kv[1],reverse=True)
        if ranked and sign*ranked[0][1]>=SIDE_MIN_SHIFT and (len(ranked)==1 or sign*(ranked[0][1]-ranked[1][1])>=SIDE_MARGIN):
            return ranked[0][0],shifts
        return None,shifts

    def _update_limits(self, st: DeviceState, profile: Profile, room: float) -> None:
        if profile.min_c is not None:
            st.cold.update(room<profile.min_c,room>=profile.min_c+LIMIT_MARGIN,ALARM_EVALS,CLEAR_EVALS)
        if profile.max_c is not None:
            st.warm.update(room>profile.max_c,room<=profile.max_c-LIMIT_MARGIN,ALARM_EVALS,CLEAR_EVALS)

    def _update_heater(self, st, profile, room, slope, significant, source) -> None:
        """A heater that should have switched on by now but hasn't.

        Learns the room temperature at which this heater usually starts (its thermostat), and
        only complains when the room is clearly below that, still falling, and the heater stays cold.
        Without any observed start there is nothing to compare with, so it stays quiet.
        """
        if not profile.source or not profile.watches("cold") or source is None:
            return
        running=source-room>2*HEATER_IDLE_GAP
        idle=source-room<HEATER_IDLE_GAP
        if running and st.heater_was_running is False and not st.heater_off.active:
            st.heater_starts.append(room)
        if running:
            st.heater_seen_running=True
        if running or idle:
            st.heater_was_running=running
        if len(st.heater_starts)>=2:
            should_run=room<median(list(st.heater_starts))-HEATER_NEAR_LIMIT
        elif st.heater_seen_running and len(st.learn)>=LEARN_ROWS_MIN:
            # In hard frost the heater may barely switch off, so there are few starts to learn
            # from: compare with the room's usual temperature instead, with a wider margin.
            should_run=room<median([r[1] for r in st.learn])-2*HEATER_NEAR_LIMIT-0.5
        else:
            return
        st.heater_off.update(idle and should_run and significant and slope<0,running,HEATER_OFF_EVALS,CLEAR_EVALS)

    # ---------------------------------------------------------------- output

    @staticmethod
    def _about(minutes: float) -> str:
        """Rounded so it doesn't promise false precision: 'about 7 min', 'about 25 min'."""
        return f"about {max(1,round(minutes))} min" if minutes<15 else f"about {5*round(minutes/5)} min"

    def _forecast_text(self, forecast: dict | None) -> str:
        if not forecast:
            return ""
        word="below" if forecast["direction"]=="cold" else "above"
        return f"; {word} {forecast['limit_c']:g} °C in {self._about(forecast['minutes'])}"

    def _severity(self, base: Severity, forecast: dict | None) -> Severity:
        if forecast and forecast["minutes"]<FORECAST_CRITICAL_MINUTES:
            return Severity.CRITICAL
        return base

    def _forecast_evidence(self, forecast: dict | None) -> dict:
        if not forecast:
            return {"forecast_minutes":None}
        return {"forecast_minutes":round(forecast["minutes"],1),"forecast_limit_c":forecast["limit_c"],
                "forecast_method":forecast["method"]}

    def _findings(self, device_id, st, profile, slope, expected, surprise, room, source, outside) -> list[Finding]:
        """slope here is the current speed (last 3 minutes), so the text agrees with the forecast."""
        findings=self._disturbance_findings(device_id,st)
        forecast=st.forecast
        covered=False  # whether the forecast is already part of another finding
        if st.rate.active:
            direction=st.direction
            side,shifts=self._side(st,profile,direction)
            st.side=side or st.side  # once a side is clear, keep it while the room recovers
            side=st.side
            verb="cooling" if direction=="cold" else "warming"
            where=(f"{'cold' if direction=='cold' else 'warm'} air from the {side} side" if side
                   else "the whole room, not one side")
            if surprise is not None:
                text=(f"Room {verb} {abs(slope):.2f} °C/min, {abs(surprise):.2f} °C/min faster than normal "
                      f"for these conditions: {where}")
            else:
                text=f"Room {verb} {abs(slope):.2f} °C/min (still learning what is normal here): {where}"
            own_forecast=forecast if forecast and forecast["direction"]==direction else None
            covered=covered or own_forecast is not None
            # The side is in the evidence, not in `sensor`: the issue's identity includes the sensor,
            # and the side changing must not turn one event into two issues.
            findings.append(Finding(
                kind="FAST_COOLING" if direction=="cold" else "FAST_WARMING",
                device_id=device_id,severity=self._severity(Severity.WARNING,own_forecast),
                message=text+self._forecast_text(own_forecast),
                evidence={"rate_c_per_min":round(slope,3),
                          "expected_c_per_min":None if expected is None else round(expected,3),
                          "surprise_c_per_min":None if surprise is None else round(surprise,3),
                          "room_c":round(room,2),"side":side,
                          "gap_shift_c":{k:round(v,2) for k,v in shifts.items()},
                          "outside_c":outside,"model_ready":st.model is not None,"profile":profile.kind,
                          **self._forecast_evidence(own_forecast)},
            ))
        severity=Severity[profile.limit_severity]
        if st.cold.active:
            findings.append(Finding("TOO_COLD",device_id,severity,
                                    f"Room went below the {profile.min_c:g} °C limit (now {room:.1f} °C)",
                                    evidence={"room_c":round(room,2),"limit_c":profile.min_c,"profile":profile.kind}))
        if st.warm.active:
            findings.append(Finding("TOO_WARM",device_id,severity,
                                    f"Room went above the {profile.max_c:g} °C limit (now {room:.1f} °C)",
                                    evidence={"room_c":round(room,2),"limit_c":profile.max_c,"profile":profile.kind}))
        if st.heater_off.active:
            own_forecast=forecast if forecast and forecast["direction"]=="cold" else None
            covered=covered or own_forecast is not None
            findings.append(Finding("HEATING_OFF",device_id,self._severity(Severity.WARNING,own_forecast),
                                    f"The heater looks off ({source:.1f} °C, about room temperature) "
                                    f"while the room is {room:.1f} °C and falling"+self._forecast_text(own_forecast),
                                    sensor=profile.source,
                                    evidence={"heater_c":round(source,2),"room_c":round(room,2),"profile":profile.kind,
                                              **self._forecast_evidence(own_forecast)}))
        if forecast and not covered:
            # A steady trend towards the limit where there is no heater to explain it (fridge, server room).
            verb="cooling" if forecast["direction"]=="cold" else "warming"
            findings.append(Finding("LIMIT_SOON",device_id,self._severity(Severity.WARNING,forecast),
                                    f"Room {verb} steadily ({slope:+.2f} °C/min, now {room:.1f} °C)"
                                    +self._forecast_text(forecast),
                                    evidence={"rate_c_per_min":round(slope,3),"room_c":round(room,2),
                                              "direction":forecast["direction"],"profile":profile.kind,
                                              **self._forecast_evidence(forecast)}))
        return findings

    def _disturbance_findings(self, device_id: str, st: DeviceState) -> list[Finding]:
        return [Finding("PROBE_DISTURBED",device_id,Severity.INFO,
                        f"{name} probe jumped {jump:+.1f} °C while the others stayed steady "
                        f"(a hand or a heat source?); ignored for a few minutes",
                        sensor=name,evidence={"jump_c":round(jump,2)})
                for name,(_,jump) in st.disturbed.items()]

    def _metrics(self, device_id, st, time, room, slope, expected, surprise) -> list[Metric]:
        if st.last_metrics is not None and time-st.last_metrics<METRICS_EVERY:
            return []
        st.last_metrics=time
        metrics=[Metric(device_id,time,"room_c",round(room,3)),
                 Metric(device_id,time,"rate_c_per_min",round(slope,4)),
                 Metric(device_id,time,"model_ready",1.0 if st.model else 0.0)]
        if expected is not None:
            metrics+=[Metric(device_id,time,"expected_rate_c_per_min",round(expected,4)),
                      Metric(device_id,time,"surprise_c_per_min",round(surprise,4))]
        if st.forecast:
            metrics.append(Metric(device_id,time,"forecast_minutes",round(st.forecast["minutes"],1)))
        return metrics
