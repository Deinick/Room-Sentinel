"""A simulated room with simulated DS18B20 probes, for demo mode and for testing the analyzers.

    room.py      physics: air, walls, heater, window, door
    probes.py    what a real probe would report: offset, lag, noise, 0.0625 °C steps, faults
    device.py    a virtual device: room + probes + scripted scenarios, one reading per simulated second
"""
