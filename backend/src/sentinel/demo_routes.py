"""Demo controls for the website and the app. Every call returns the demo's new state.

    GET  /demo                          all demo devices and their state
    GET  /demo/scenarios                scripted scenarios you can start
    GET  /demo/{id}                     state: controls, true temperatures, heat flows, speed
    POST /demo/{id}/controls            {"outside_c": -5, "window": "open", ...} (any subset)
    POST /demo/{id}/probe               {"sensor": "Door", "action": "unplug" | "plug" | "hand"}
    POST /demo/{id}/run                 {"speed": 60} and/or {"paused": true}
    POST /demo/{id}/scenario            {"name": "window_open"}
    POST /demo/{id}/reset               back to a settled room at 1x

There is one demo room per demo id, shared by everyone who is signed in.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from src.auth.dependencies import get_current_user
from src.sentinel.demo import MAX_SPEED, DemoRunner
from src.sentinel.sim.device import SCENARIOS

router=APIRouter(prefix="/demo",tags=["demo"],dependencies=[Depends(get_current_user)])

SensorName=Literal["Centre","Window","Heater","Door","Far wall"]


class ControlsIn(BaseModel):
    outside_c: float | None=Field(None,ge=-30,le=40)
    corridor_c: float | None=Field(None,ge=0,le=35)
    window: Literal["closed","tilted","open"] | None=None
    door_open: bool | None=None
    heater: Literal["auto","on","off"] | None=None
    setpoint_c: float | None=Field(None,ge=10,le=30)


class ProbeIn(BaseModel):
    sensor: SensorName
    action: Literal["unplug","plug","hand"]
    seconds: int=Field(60,ge=5,le=600)  # only for "hand"


class RunIn(BaseModel):
    speed: float | None=Field(None,gt=0,le=MAX_SPEED)
    paused: bool | None=None


class ScenarioIn(BaseModel):
    name: str


def _demo(device_id: str, request: Request) -> DemoRunner:
    demo=getattr(request.app.state,"demos",{}).get(device_id)
    if demo is None:
        raise HTTPException(404,f"No demo device {device_id!r}.")
    return demo


DemoDep=Annotated[DemoRunner,Depends(_demo)]


@router.get("",summary="All demo devices and their state")
def list_demos(request: Request) -> list[dict]:
    return [d.state() for d in getattr(request.app.state,"demos",{}).values()]


@router.get("/scenarios",summary="Scripted scenarios")
def list_scenarios() -> dict:
    return {name:[{"minute":m,"change":c} for m,c in steps] for name,steps in SCENARIOS.items()}


@router.get("/{device_id}",summary="Demo state, including what is really happening")
def get_demo(demo: DemoDep) -> dict:
    return demo.state()


@router.post("/{device_id}/controls",summary="Change outside temperature, window, door, heater")
def set_controls(payload: ControlsIn, demo: DemoDep) -> dict:
    demo.change(payload.model_dump(exclude_none=True))
    return demo.state()


@router.post("/{device_id}/probe",summary="Unplug, plug back in, or put a hand on a probe")
def probe(payload: ProbeIn, demo: DemoDep) -> dict:
    change={payload.action:payload.sensor}
    if payload.action=="hand":
        change["seconds"]=payload.seconds
    demo.change(change)
    return demo.state()


@router.post("/{device_id}/run",summary="Speed (1-120x) and pause")
def run(payload: RunIn, demo: DemoDep) -> dict:
    if payload.speed is not None:
        demo.set_speed(payload.speed)
    if payload.paused is not None:
        demo.set_paused(payload.paused)
    return demo.state()


@router.post("/{device_id}/scenario",summary="Start a scripted scenario from now")
def start_scenario(payload: ScenarioIn, demo: DemoDep) -> dict:
    if payload.name not in SCENARIOS:
        raise HTTPException(422,f"Unknown scenario. Choose one of: {', '.join(SCENARIOS)}.")
    demo.start_scenario(payload.name)
    return demo.state()


@router.post("/{device_id}/reset",summary="Back to a settled room at 1x")
def reset(demo: DemoDep) -> dict:
    demo.reset()
    return demo.state()
