"""Optional local text-tone scores, not an assessment of people or emotions."""
import json
import os
import sys
from transformers import pipeline

request=json.load(sys.stdin)
model=os.getenv("SENTIMENT_MODEL","cardiffnlp/twitter-roberta-base-sentiment-latest")
classifier=pipeline("text-classification",model=model,device=-1)
results=classifier(request["texts"],top_k=None,truncation=True,max_length=256,batch_size=16)
label_map={"label_0":"negative","label_1":"neutral","label_2":"positive","0":"negative","1":"neutral","2":"positive"}
rows=[]
for result in results:
    scores={"negative":0.0,"neutral":0.0,"positive":0.0}
    for item in result:
        label=item["label"].lower()
        label=label_map.get(label,label)
        if label in scores:
            scores[label]=float(item["score"])
    rows.append(scores)
print(json.dumps({"model":model,"scores":rows}))
