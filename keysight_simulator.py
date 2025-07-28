import socket
import threading
import random
import time
from typing import Dict, Tuple

class KeysightSimulator:
    def __init__(self, port, min_value=0.0, max_value=1.0, resistance=1000.0):
        self.port = port
        self.min_value = min_value
        self.max_value = max_value
        self.resistance = resistance
        self.running = False
        self.thread = None

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("", self.port))
            s.listen()
            print(f"Simulator listening on port {self.port}")
            while self.running:
                try:
                    conn, addr = s.accept()
                except OSError:
                    break
                threading.Thread(target=self.handle_client, args=(conn,), daemon=True).start()

    def handle_client(self, conn):
        print(f"Client connected on port {self.port}")
        with conn:
            file = conn.makefile("r")
            for line in file:
                line = line.strip().upper()
                if line in ("MEAS?", "READ?"):
                    value = random.uniform(self.min_value, self.max_value)
                    conn.sendall(f"{value:.3f}\n".encode())
                elif line in ("RES?", "RES"):
                    conn.sendall(f"{self.resistance:.3f}\n".encode())
                elif line == "QUIT":
                    break
                else:
                    conn.sendall(b"ERR\n")
        print(f"Client disconnected from port {self.port}")

    def stop(self):
        self.running = False
        # open a connection to release accept
        try:
            socket.create_connection(("localhost", self.port), timeout=1).close()
        except OSError:
            pass
        if self.thread is not None:
            self.thread.join(timeout=1)


class EvaluationContainer:
    """Collects results from multiple simulated devices."""

    def __init__(self, expected_devices: int):
        self.expected_devices = expected_devices
        self.deviceScriptResults: Dict[Tuple[str, str, str], float] = {}
        self._lock = threading.Lock()
        self._finished = threading.Event()

    def add_result(self, board: str, dut: str, device: str, value: float) -> None:
        with self._lock:
            self.deviceScriptResults[(board, dut, device)] = value
            if len(self.deviceScriptResults) >= self.expected_devices:
                self._finished.set()

    def wait_until_finished(self) -> None:
        self._finished.wait()
        self.on_evaluation_finished()

    def on_evaluation_finished(self) -> None:
        _core_EvaluationFinished(self.deviceScriptResults)


def _core_EvaluationFinished(results: Dict[Tuple[str, str, str], float]) -> None:
    """Callback mimicking frm_StartMeasurement._core_EvaluationFinished."""
    print("Evaluation finished. Results:")
    for (board, dut, device), value in results.items():
        print(f"  {device} -> {board}/{dut}: {value:.3f}")


def demo_parallel_evaluation(args) -> None:
    """Demonstrate two devices writing results in parallel to an evaluation container."""
    simulators = []
    for i in range(args.devices):
        port = args.start_port + i
        sim = KeysightSimulator(port, args.min, args.max, args.resistance)
        sim.start()
        simulators.append(sim)

    container = EvaluationContainer(args.devices)

    def query_device(idx: int, port: int):
        # Simulate slight delay between devices (up to 7 seconds)
        time.sleep(random.uniform(0, 7))
        try:
            with socket.create_connection(("localhost", port), timeout=5) as s:
                s.sendall(b"MEAS?\n")
                resp = s.recv(32).decode().strip()
                value = float(resp)
        except Exception as exc:
            print(f"Device {idx} error: {exc}")
            value = float('nan')
        container.add_result(f"board{idx}", f"dut{idx}", f"device{idx}", value)

    threads = [threading.Thread(target=query_device, args=(i, sim.port), daemon=True)
               for i, sim in enumerate(simulators)]
    for t in threads:
        t.start()

    container.wait_until_finished()

    for t in threads:
        t.join()

    for sim in simulators:
        sim.stop()


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Keysight device simulator")
    parser.add_argument("--devices", type=int, default=2, help="number of devices")
    parser.add_argument("--start-port", type=int, default=5025, help="starting TCP port")
    parser.add_argument("--min", type=float, default=0.0, help="minimum measurement value")
    parser.add_argument("--max", type=float, default=1.0, help="maximum measurement value")
    parser.add_argument("--resistance", type=float, default=1000.0, help="reported resistance value")
    parser.add_argument("--demo", action="store_true", help="run parallel evaluation demo")
    args = parser.parse_args()

    if args.demo:
        demo_parallel_evaluation(args)
        return

    simulators = []
    for i in range(args.devices):
        port = args.start_port + i
        sim = KeysightSimulator(port, args.min, args.max, args.resistance)
        sim.start()
        simulators.append(sim)

    print("Simulators running. Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        for sim in simulators:
            sim.stop()

if __name__ == "__main__":
    main()
