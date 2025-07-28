# volkan

## Keysight Simulator

The repository provides a small Python utility `keysight_simulator.py` that mimics
Keysight measurement devices over TCP/IP. Two devices are started by default,
listening on consecutive ports beginning with `5025`.

The simulator understands the following simple commands:

- `MEAS?` or `READ?` &ndash; returns a random value between the configured
  minimum and maximum.
- `RES?` or `RES` &ndash; returns the configured resistance value.

### Running the simulator

```bash
python3 keysight_simulator.py --devices 2 --start-port 5025 --min 0 --max 5 --resistance 1000
```

To see both simulated devices send their results in parallel and trigger the
evaluation callback, run the demo mode:

```bash
python3 keysight_simulator.py --demo
```

Stop the program with `Ctrl+C`.
