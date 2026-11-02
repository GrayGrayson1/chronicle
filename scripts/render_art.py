"""Deterministic card rendering and AI-sprite-sheet assembly. No remote APIs."""
import json
import math
from pathlib import Path
import sys
import textwrap

from PIL import Image, ImageDraw, ImageFont

request=json.load(sys.stdin)
output=Path(request["output"])
portrait=Image.open(request["portrait"]).convert("RGBA")

def font(size,bold=False):
    options=["DejaVuSerif-Bold.ttf" if bold else "DejaVuSerif.ttf", "C:/Windows/Fonts/georgiab.ttf" if bold else "C:/Windows/Fonts/georgia.ttf"]
    for path in options:
        try:
            return ImageFont.truetype(path,size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)

if request.get("type")=="sprite":
    # The local image model supplies an aligned 4x2 sheet. This renderer does
    # not invent animation; it assembles the model's eight visual frames.
    frames=[]
    width,height=portrait.size
    for y in range(2):
        for x in range(4):
            frame=portrait.crop((x*width//4,y*height//2,(x+1)*width//4,(y+1)*height//2)).resize((128,128),Image.Resampling.NEAREST)
            frames.append(frame.convert("P",palette=Image.Palette.ADAPTIVE,colors=128))
    frames[0].save(output,save_all=True,append_images=frames[1:],duration=140,loop=0,optimize=True)
else:
    themes={"parchment":("#f5edcf","#3c3629","#a88c49"),"night":("#17242e","#f6f4e9","#8cb9b5"),"azure":("#eaf1f7","#203d58","#7c9fba"),"verdant":("#e7eddf","#2e4934","#89a269"),"infernal":("#261d21","#f6e4d4","#bb775b")}
    bg,ink,accent=themes.get(request.get("theme"),themes["parchment"])
    card=Image.new("RGB",(1200,1680),bg);draw=ImageDraw.Draw(card)
    draw.rounded_rectangle((20,20,1180,1660),radius=30,outline=accent,width=6)
    draw.rounded_rectangle((40,40,1160,1640),radius=22,outline=accent,width=2)
    draw.text((600,80),"CHRONICLE",font=font(24),fill=accent,anchor="mm")
    # Crop position and zoom are explicit user settings.
    aspect=1040/820;zoom=max(1,min(3,float(request.get("zoom",1))))
    crop_w=min(portrait.width,portrait.height*aspect)/zoom;crop_h=crop_w/aspect
    px=max(0,min(1,float(request.get("panX",0.5))));py=max(0,min(1,float(request.get("panY",0.5))))
    left=(portrait.width-crop_w)*px;top=(portrait.height-crop_h)*py
    photo=portrait.crop((left,top,left+crop_w,top+crop_h)).resize((1040,820),Image.Resampling.LANCZOS)
    card.paste(photo.convert("RGB"),(80,125));draw.rectangle((79,124,1121,946),outline=accent,width=3)
    title=str(request.get("title","Campaign card"))[:70]
    title_size=56
    while draw.textlength(title,font=font(title_size,True))>1030 and title_size>22:
        title_size-=2
    draw.text((600,1000),title,font=font(title_size,True),fill=ink,anchor="mm")
    draw.text((600,1060),str(request.get("subtitle",""))[:100],font=font(24),fill=accent,anchor="mm")
    body=str(request.get("body",""))[:900]
    lines=[]
    for paragraph in body.splitlines():
        lines.extend(textwrap.wrap(paragraph,62) or [""])
    for i,line in enumerate(lines[:8]):
        draw.text((95,1120+i*39),line,font=font(27),fill=ink)
    stats=request.get("stats",[])[:6]
    for i,item in enumerate(stats):
        col=i%3;row=i//3;x=95+col*350;y=1450+row*65
        draw.text((x,y),str(item.get("label",""))[:20].upper(),font=font(15),fill=accent)
        draw.text((x,y+23),str(item.get("value",""))[:25],font=font(24,True),fill=ink)
    draw.text((600,1600),str(request.get("kind","CAMPAIGN ARTIFACT")).upper(),font=font(15),fill=accent,anchor="mm")
    card.save(output,format="PNG")
print(json.dumps({"path":str(output.resolve())}))
