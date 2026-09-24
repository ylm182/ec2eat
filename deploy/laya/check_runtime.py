"""Check the optional imports HF performs before loading our custom handler."""
from importlib.metadata import version
from transformers import WhisperForConditionalGeneration, pipeline
import torchvision
import torchaudio

for package in ("laya", "torch", "torchvision", "torchaudio", "transformers", "huggingface-hub", "numpy"):
    print(f"{package}=={version(package)}")
print("HF startup imports passed; run smoke.py next to verify actual Laya inference.")
