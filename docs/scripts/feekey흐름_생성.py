# -*- coding: utf-8 -*-
"""체결 → 조회키(feeKey) 구성 프로세스도. 함수명 대신 각 단계의 역할 설명. 독립 이미지."""
import math
from PIL import Image, ImageDraw, ImageFont

S = 2
FONTPATH = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
OUT = '/Users/yujin-an/dev/fees/docs/feeKey_구성흐름.png'

def F(sz, idx=2):
    return ImageFont.truetype(FONTPATH, sz * S, index=idx)

WHITE = (255, 255, 255); NAVY = (31, 58, 95); GREY = (100, 102, 112)
BLUE_F = (232, 238, 246); BLUE_O = (150, 170, 198)
AMBER_F = (250, 239, 220); AMBER_O = (210, 170, 110); AMBER_T = (150, 95, 10)
TEAL_F = (223, 242, 238); TEAL_O = (120, 178, 168); TEAL_T = (25, 110, 98)
PURP_F = (238, 233, 246); PURP_O = (165, 148, 195); PURP_T = (95, 72, 140)
GREEN_F = (223, 242, 231); GREEN_O = (120, 180, 150); GREEN_T = (31, 110, 80)
GREY_F = (240, 241, 244); GREY_O = (195, 197, 205)

img = Image.new('RGB', (1080 * S, 820 * S), WHITE)
d = ImageDraw.Draw(img)


def wrap(text, font, maxw):
    out = []
    for raw in text.split('\n'):
        words, cur = raw.split(' '), ''
        for w in words:
            t = (cur + ' ' + w).strip()
            if d.textlength(t, font=font) <= maxw or not cur:
                cur = t
            else:
                out.append(cur); cur = w
        out.append(cur)
    return out


def box(x, y, w, h, title, lines, fill, outline, tcolor=NAVY, bcolor=GREY, tsz=16, bsz=12, dashed=False, radius=14):
    X, Y, W, H = x * S, y * S, w * S, h * S
    if dashed:
        d.rounded_rectangle([X, Y, X + W, Y + H], radius=radius * S, fill=fill, outline=None)
        # 점선 테두리
        per = 2 * (w + h); step = 12
        pts = []
        # 단순히 실선 얇게 + 점선 느낌은 생략, 회색 실선
        d.rounded_rectangle([X, Y, X + W, Y + H], radius=radius * S, outline=outline, width=2 * S)
    else:
        d.rounded_rectangle([X, Y, X + W, Y + H], radius=radius * S, fill=fill, outline=outline, width=2 * S)
    tf, bf = F(tsz, 5), F(bsz)
    tw = d.textlength(title, font=tf)
    d.text((X + (W - tw) / 2, Y + 12 * S), title, font=tf, fill=tcolor)
    yy = Y + 12 * S + tsz * S + 9 * S
    for ln in lines:
        for sub in wrap(ln, bf, w * S - 28 * S):
            sw = d.textlength(sub, font=bf)
            d.text((X + (W - sw) / 2, yy), sub, font=bf, fill=bcolor)
            yy += bsz * S + 6 * S


def diamond(cx, cy, w, h, title, fill, outline, tcolor):
    pts = [(cx, cy - h / 2), (cx + w / 2, cy), (cx, cy + h / 2), (cx - w / 2, cy)]
    d.polygon([(p[0] * S, p[1] * S) for p in pts], fill=fill, outline=outline)
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]
        d.line([(a[0] * S, a[1] * S), (b[0] * S, b[1] * S)], fill=outline, width=2 * S)
    tf = F(15, 5)
    for j, ln in enumerate(title.split('\n')):
        tw = d.textlength(ln, font=tf)
        d.text((cx * S - tw / 2, cy * S - (len(title.split('\n')) * 9 - j * 19) * S), ln, font=tf, fill=tcolor)


def arrow(p1, p2, color=NAVY, w=3, label=None, lcolor=GREY):
    a = (p1[0] * S, p1[1] * S); b = (p2[0] * S, p2[1] * S)
    d.line([a, b], fill=color, width=w * S)
    ang = math.atan2(b[1] - a[1], b[0] - a[0]); sz = 12 * S
    d.polygon([b, (b[0] - sz * math.cos(ang - 0.45), b[1] - sz * math.sin(ang - 0.45)),
               (b[0] - sz * math.cos(ang + 0.45), b[1] - sz * math.sin(ang + 0.45))], fill=color)
    if label:
        mx, my = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
        f = F(11)
        for j, ln in enumerate(label.split('\n')):
            tw = d.textlength(ln, font=f)
            yy = my + (j - (len(label.split('\n')) - 1) / 2) * 15
            d.rectangle([mx * S - tw / 2 - 4 * S, yy * S - 8 * S, mx * S + tw / 2 + 4 * S, yy * S + 8 * S], fill=WHITE)
            d.text((mx * S - tw / 2, yy * S - 7 * S), ln, font=f, fill=lcolor)


# ===== 제목
d.text((40 * S, 26 * S), '체결이 조회키(feeKey)가 되는 과정', font=F(20, 5), fill=NAVY)
d.text((40 * S, 60 * S), '각 단계의 역할 중심 — “무엇을 읽어, 어떤 키를 만드는가”', font=F(11), fill=GREY)

# ① 체결
box(330, 96, 420, 92, '① 체결 발생', ['고객 주문이 체결됨 —', '어떤 상품을, 어떤 세션·주문채널로 거래했는가'], BLUE_F, BLUE_O)

# ② 상품 축 / ③ 주문 축
box(70, 236, 420, 108, '② 상품에서 축을 읽음', ['체결된 상품(종목)에서 상품군·거래소를,', '파생이면 품목코드까지 읽는다'], BLUE_F, BLUE_O)
box(590, 236, 420, 108, '③ 주문에서 축을 읽음', ['세션(프리/정규/애프터)과', '주문채널(HTS·MTS·API·ARS·센터·반대매매)을 읽는다'], BLUE_F, BLUE_O)

# ④ 분기
diamond(540, 430, 360, 132, '④ 상품군이\n파생인가?', AMBER_F, AMBER_O, AMBER_T)

# ⑤ 분기 결과
box(60, 548, 445, 150, '⑤ 주식형 → 품목 “붕괴”', [
    '종목 단위로 수수료를 나누지 않으므로', '품목을 키에서 없앤다(비움).',
    '거래소·세션·채널만으로 식별', '— 가장 큰 축을 없애 규모를 줄임'], TEAL_F, TEAL_O, TEAL_T)
box(575, 548, 445, 150, '⑤ 파생 → 품목 “유지”', [
    '파생은 품목마다 수수료가 다르므로', '품목코드를 키에 남긴다',
    '(거래소·세션·채널 + 품목)'], PURP_F, PURP_O, PURP_T)

# ⑥ feeKey
box(285, 736, 510, 76, '⑥ 조회키(feeKey) 완성', [
    '상품군 · 거래소 · 세션 · 채널 · 품목(주식=없음)  →  이 키로 정책 탐색·해석 캐시 조회'],
    GREEN_F, GREEN_O, GREEN_T)

# ※ 제외 노트
box(40, 736, 220, 76, '※ 조회키에 넣지 않음', [
    '계좌 → 협의·이력 조회에', '체결가·수량 → 금액 계산에'], GREY_F, GREY_O, tcolor=GREY, bcolor=GREY, tsz=13, bsz=10.5, radius=10)

# ===== 화살표
arrow((450, 188), (300, 236))          # 체결 → 상품 축
arrow((630, 188), (790, 236))          # 체결 → 주문 축
arrow((280, 344), (470, 372))          # 상품 축 → 분기
arrow((800, 344), (610, 372))          # 주문 축 → 분기
arrow((420, 452), (282, 548), label='아니오 · 주식형\n(국내주식·해외주식·금현물)')   # 분기 → 주식형
arrow((660, 452), (798, 548), label='예 · 파생\n(국내파생·해외파생)')            # 분기 → 파생
arrow((282, 698), (430, 736))          # 주식형 → feeKey
arrow((798, 698), (650, 736))          # 파생 → feeKey

img.save(OUT)
print('saved', OUT, img.size)
