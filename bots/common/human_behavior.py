import random


MOODS = ["calm", "greedy", "fearful", "confused", "impulsive"]


class HumanBehavior:
    def __init__(self):
        self.mood = random.choice(MOODS)
        self.mood_timer = random.randint(4, 18)

    def update_mood(self):
        self.mood_timer -= 1

        if self.mood_timer <= 0:
            self.mood = random.choice(MOODS)
            self.mood_timer = random.randint(4, 18)

    def chance(self, probability: float) -> bool:
        return random.random() < probability

    def noisy_threshold(self, value: float, noise: float = 0.006) -> float:
        return value + random.uniform(-noise, noise)

    def human_amount(self, base_amount: float, min_amount: float = 0.0001) -> float:
        multiplier = random.uniform(0.35, 1.35)

        if self.mood == "greedy":
            multiplier *= random.uniform(1.1, 1.8)

        if self.mood == "fearful":
            multiplier *= random.uniform(0.4, 0.9)

        if self.mood == "impulsive":
            multiplier *= random.uniform(0.6, 2.0)

        amount = round(base_amount * multiplier, 4)

        return max(amount, min_amount)

    def should_ignore_signal(self) -> bool:
        probabilities = {
            "calm": 0.12,
            "greedy": 0.08,
            "fearful": 0.25,
            "confused": 0.40,
            "impulsive": 0.18,
        }

        return self.chance(probabilities.get(self.mood, 0.2))

    def should_do_random_trade(self) -> bool:
        probabilities = {
            "calm": 0.03,
            "greedy": 0.08,
            "fearful": 0.06,
            "confused": 0.15,
            "impulsive": 0.22,
        }

        return self.chance(probabilities.get(self.mood, 0.08))

    def should_panic_sell(self) -> bool:
        return self.mood == "fearful" and self.chance(0.25)

    def should_fomo_buy(self) -> bool:
        return self.mood == "greedy" and self.chance(0.25)

    def noisy_price(self, price: float) -> float:
        return price * random.uniform(0.985, 1.015)