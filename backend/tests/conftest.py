import sys
from pathlib import Path

# Make `import src.sentinel...` work when pytest is run from backend/.
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
