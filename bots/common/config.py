import json
from pathlib import Path

# Resolve the bots/ directory regardless of where the importing file lives
_BOTS_ROOT = Path(__file__).resolve().parent.parent  # common/ -> bots/
CONFIG = json.loads((_BOTS_ROOT / "config.json").read_text())
