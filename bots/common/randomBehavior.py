import random


def choose_intensity():
    r = random.random()

    if r < 0.80:
        return "normal"

    if r < 0.95:
        return "medium"

    return "whale"


def maybe_ignore_signal():
    return random.random() < 0.10


def maybe_reverse_signal():
    return random.random() < 0.05


def maybe_explore():
    return random.random() < 0.35


def random_action():
    return random.choice(["buy", "sell"])


def randomize_threshold(value):
    return value * random.uniform(0.45, 1.70)


def buy_amount(cash, cfg):
    intensity = choose_intensity()
    level = cfg[intensity]

    max_allowed = min(level["max_buy"], cash * level["buy_fraction"])

    if max_allowed <= level["min_buy"]:
        return None, intensity

    return round(random.uniform(level["min_buy"], max_allowed), 4), intensity


def sell_amount(balance, cfg):
    intensity = choose_intensity()
    level = cfg[intensity]

    max_allowed = balance * level["sell_fraction"]

    if max_allowed <= level["min_sell"]:
        return None, intensity

    return round(random.uniform(level["min_sell"], max_allowed), 4), intensity


def almost_sell_all(balance):
    if random.random() < 0.015:
        return round(balance * random.uniform(0.75, 0.98), 4)

    return None