"""
Rewrite EmbeddingGemma's 8-bit ONNX graph so the token embedding is looked up
before it is dequantized. Produces `model_quantized_gather_first.onnx`, which
`scripts/download-embedding-model.mjs` installs beside the downloaded weights
and the desktop app runs (`src-tauri/src/embeddings.rs`).

Why: the graph stores weights as int8 and dequantizes each one on every run.
For the token embedding that means expanding the whole 262144 x 768 table to
float32 (805 MB) to read a few dozen rows, which put the app's footprint at
1.6 GB. Gathering the int8 rows first and dequantizing only those gives
bit-identical output (the scale and zero point are per-tensor) at ~650 MB, and
runs faster.

Only the graph changes; it still reads `model_quantized.onnx_data` by the same
offsets, so the weights file is the one downloaded from Hugging Face.

Usage (needs `pip install onnx`):
    python scripts/embedding-graph/gather_first.py \
        src-tauri/assets/embedding-models/onnx-community/embeddinggemma-300m-ONNX/onnx/model_quantized.onnx \
        scripts/embedding-graph/model_quantized_gather_first.onnx
Then update EMBEDDING_GRAPH's sha256 in scripts/lib/embeddingModel.mjs.
"""
import sys

import onnx
from onnx import helper

src, dst = sys.argv[1], sys.argv[2]
model = onnx.load(src, load_external_data=False)
graph = model.graph

TABLE = 'model.embed_tokens.weight_quantized'
TABLE_DEQUANTIZED = 'model.embed_tokens.weight_dequantized_tensor'

nodes = list(graph.node)
dequantize = next(n for n in nodes if n.op_type == 'DequantizeLinear' and n.output[0] == TABLE_DEQUANTIZED)
users = [n for n in nodes if TABLE_DEQUANTIZED in n.input]
assert len(users) == 1 and users[0].op_type == 'Gather', users
gather = users[0]
assert all(a.name == 'axis' and a.i == 0 for a in gather.attribute)

rows = '/model/embed_tokens/Gather_quantized/output_0'
gather_rows = helper.make_node('Gather', [TABLE, gather.input[1]], [rows], name='/model/embed_tokens/Gather_quantized', axis=0)
dequantize_rows = helper.make_node(
    'DequantizeLinear', [rows, dequantize.input[1], dequantize.input[2]], list(gather.output),
    name='/model/embed_tokens/DequantizeLinear_rows',
)

rewritten = []
for node in nodes:
    if node is dequantize:
        continue
    if node is gather:
        rewritten += [gather_rows, dequantize_rows]
    else:
        rewritten.append(node)
del graph.node[:]
graph.node.extend(rewritten)

# onnx.checker can't be used: it rejects the contrib ops this graph relies on
# (SimplifiedLayerNormalization and others). The Rust tests check the output.
onnx.save(model, dst)
print(f'wrote {dst}')
