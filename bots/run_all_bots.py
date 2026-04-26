import sys
import time
import signal
import subprocess

BOT_MODULES = [
    "bots.causes.noiseBot",
    "bots.causes.shockBot",
    "bots.causes.trendBot",
    "bots.conservativeBot",
    "bots.momentumBot",
    "bots.meanReversionBot",
    "bots.marketMakerBot",
]

processes = []


def start_bots():
    print("A iniciar todos os bots...\n")

    for module_name in BOT_MODULES:
        print(f"Iniciando modulo: {module_name}")

        process = subprocess.Popen(
            [sys.executable, "-m", module_name],
            stdout=None,
            stderr=None
        )

        processes.append(process)

    print("\nTodos os bots foram iniciados.")
    print("Pressiona CTRL+C para parar todos.\n")


def stop_bots():
    print("\nA parar todos os bots...")

    for process in processes:
        if process.poll() is None:
            process.terminate()

    time.sleep(1)

    for process in processes:
        if process.poll() is None:
            process.kill()

    print("Todos os bots foram encerrados.")


def handle_exit(signum, frame):
    stop_bots()
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, handle_exit)
    signal.signal(signal.SIGTERM, handle_exit)

    start_bots()

    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        stop_bots()