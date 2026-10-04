"""Small statistics helpers. Plain Python: the inputs are a few hundred numbers at most."""

import math


def median(values: list[float]) -> float | None:
    if not values:
        return None
    s=sorted(values)
    mid=len(s)//2
    return s[mid] if len(s)%2 else (s[mid-1]+s[mid])/2


def robust_sigma(values: list[float]) -> float:
    """Standard deviation estimated from the median absolute deviation, so one spike can't inflate it."""
    m=median(values)
    if m is None:
        return 0.0
    return 1.4826*median([abs(v-m) for v in values])


def line_fit(xs: list[float], ys: list[float]) -> tuple[float,float,float] | None:
    """Straight line through the points: (slope, intercept, standard error of the slope)."""
    n=len(xs)
    if n<3:
        return None
    mx=sum(xs)/n
    my=sum(ys)/n
    sxx=sum((x-mx)**2 for x in xs)
    if sxx==0:
        return None
    slope=sum((x-mx)*(y-my) for x,y in zip(xs,ys))/sxx
    intercept=my-slope*mx
    sse=sum((y-intercept-slope*x)**2 for x,y in zip(xs,ys))
    return slope,intercept,math.sqrt(sse/(n-2)/sxx)


def least_squares(rows: list[list[float]], ys: list[float]) -> list[float] | None:
    """Coefficients b minimising |rows @ b - ys|, via the normal equations. None if the data can't pin them down."""
    k=len(rows[0])
    a=[[sum(r[i]*r[j] for r in rows) for j in range(k)]+[sum(r[i]*y for r,y in zip(rows,ys))] for i in range(k)]
    for col in range(k):
        pivot=max(range(col,k),key=lambda r:abs(a[r][col]))
        if abs(a[pivot][col])<1e-12:
            return None
        a[col],a[pivot]=a[pivot],a[col]
        for r in range(k):
            if r!=col:
                factor=a[r][col]/a[col][col]
                a[r]=[x-factor*y for x,y in zip(a[r],a[col])]
    return [a[i][k]/a[i][i] for i in range(k)]
