"""A bounded batch embedding job. JSON input/output; model data remains local."""
import json
import os
import sys

from sentence_transformers import SentenceTransformer

request = json.load(sys.stdin)
texts = request.get("texts", [])
if not isinstance(texts, list) or len(texts) > 500 or any(not isinstance(v, str) or len(v) > 20000 for v in texts):
    raise ValueError("Invalid embedding batch")
model_name = os.getenv("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
model = SentenceTransformer(model_name, device=os.getenv("EMBED_DEVICE", "cpu"))
vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False).tolist() if texts else []
print(json.dumps({"model": model_name, "vectors": vectors}))
