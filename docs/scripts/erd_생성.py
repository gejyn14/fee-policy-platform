# -*- coding: utf-8 -*-
"""수수료 정책 플랫폼 데이터 모델 ERD (엔티티 박스 + 관계선). 독립 이미지."""
import math
from PIL import Image, ImageDraw, ImageFont

S = 2
FONTPATH = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
OUT = '/Users/yujin-an/dev/fees/docs/데이터모델_ERD.png'

def F(sz, idx=2):
    return ImageFont.truetype(FONTPATH, sz * S, index=idx)

WHITE = (255, 255, 255)
INK = (60, 66, 82)
LINE = (110, 120, 140)
PK = (31, 58, 95)
FK = (176, 120, 40)
GREY = (110, 112, 122)
# 헤더 색상 팔레트(계열별)
H_RULE = (47, 84, 150)      # 규칙 계열
H_SCHED = (36, 122, 108)    # 요율표 계열
H_ACCT = (150, 96, 40)      # 계좌 계열
H_REF = (110, 96, 150)      # 참조/캐시

img = Image.new('RGB', (1520 * S, 820 * S), WHITE)
d = ImageDraw.Draw(img)

geom = {}


def entity(key, x, y, w, name, ko, fields, hc):
    header_h, rh = 48, 26
    H = header_h + len(fields) * rh + 10
    X, Y, W, Hs = x * S, y * S, w * S, H * S
    d.rounded_rectangle([X, Y, X + W, Y + Hs], radius=9 * S, fill=WHITE, outline=(70, 80, 100), width=2 * S)
    # 헤더(상단 라운드, 하단 사각)
    d.rounded_rectangle([X, Y, X + W, Y + header_h * S], radius=9 * S, fill=hc)
    d.rectangle([X, Y + (header_h - 12) * S, X + W, Y + header_h * S], fill=hc)
    d.text((X + 14 * S, Y + 8 * S), name, font=F(15, 5), fill=WHITE)
    d.text((X + 14 * S, Y + 29 * S), ko, font=F(10), fill=(238, 238, 244))
    ff, ffb = F(11), F(11, 5)
    for i, (col, kind) in enumerate(fields):
        yy = Y + (header_h + 7) * S + i * rh * S
        cx = X + 14 * S
        if kind == 'pk':
            d.ellipse([cx, yy + 3 * S, cx + 9 * S, yy + 12 * S], fill=PK); font, tc = ffb, PK
        elif kind == 'fk':
            d.ellipse([cx, yy + 3 * S, cx + 9 * S, yy + 12 * S], fill=FK); font, tc = ff, FK
        else:
            font, tc = ff, INK
        d.text((cx + 16 * S, yy), col, font=font, fill=tc)
        if i < len(fields) - 1:
            d.line([(X + 6 * S, yy + rh * S - 3 * S), (X + W - 6 * S, yy + rh * S - 3 * S)], fill=(238, 239, 243), width=1 * S)
    geom[key] = (x, y, w, H)
    return H


def right(k, dy=40): g = geom[k]; return (g[0] + g[2], g[1] + dy)
def left(k, dy=40): g = geom[k]; return (g[0], g[1] + dy)
def topc(k): g = geom[k]; return (g[0] + g[2] / 2, g[1])
def botc(k): g = geom[k]; return (g[0] + g[2] / 2, g[1] + g[3])


def line(p1, p2, color=LINE, w=2):
    d.line([(p1[0] * S, p1[1] * S), (p2[0] * S, p2[1] * S)], fill=color, width=w * S)


def dline(p1, p2, color=(150, 140, 175), w=2, dash=9):
    x1, y1 = p1; x2, y2 = p2; dist = math.hypot(x2 - x1, y2 - y1); n = max(2, int(dist / dash))
    for i in range(0, n, 2):
        t1, t2 = i / n, min((i + 1) / n, 1)
        line((x1 + (x2 - x1) * t1, y1 + (y2 - y1) * t1), (x1 + (x2 - x1) * t2, y1 + (y2 - y1) * t2), color, w)


def crow(tip, ang, color=LINE):
    """many(N) 쪽 까마귀발 — tip에서 ang 반대방향으로 3갈래."""
    L = 15
    for da in (-0.42, 0, 0.42):
        line(tip, (tip[0] - L * math.cos(ang + da), tip[1] - L * math.sin(ang + da)), color, 2)


def onebar(tip, ang, color=LINE):
    """one(1) 쪽 짧은 수직 바."""
    p = 8
    perp = ang + math.pi / 2
    base = (tip[0] - 12 * math.cos(ang), tip[1] - 12 * math.sin(ang))
    line((base[0] - p * math.cos(perp), base[1] - p * math.sin(perp)),
         (base[0] + p * math.cos(perp), base[1] + p * math.sin(perp)), color, 2)


def label(mid, text, color=GREY, sz=10):
    f = F(sz)
    tw = d.textlength(text, font=f)
    pad = 4 * S
    d.rectangle([mid[0] * S - tw / 2 - pad, mid[1] * S - sz * S / 2 - 2 * S,
                 mid[0] * S + tw / 2 + pad, mid[1] * S + sz * S / 2 + 4 * S], fill=WHITE)
    d.text((mid[0] * S - tw / 2, mid[1] * S - sz * S / 2), text, font=f, fill=color)


def title(x, y, text, sz, color=INK, idx=5):
    d.text((x * S, y * S), text, font=F(sz, idx), fill=color)


# ===== 제목 + 범례
title(40, 26, '수수료 정책 플랫폼 — 데이터 모델 (ERD)', 20)
lx = 44
for txt, col in [('규칙 계열', H_RULE), ('요율표 계열', H_SCHED), ('계좌 계열', H_ACCT), ('참조/캐시', H_REF)]:
    d.ellipse([lx * S, 58 * S, (lx + 9) * S, 67 * S], fill=col)
    d.text(((lx + 15) * S, 56 * S), txt, font=F(10), fill=GREY)
    lx += 15 + d.textlength(txt, font=F(10)) / S + 22
lx += 14
d.ellipse([lx * S, 58 * S, (lx + 9) * S, 67 * S], fill=PK)
d.text(((lx + 15) * S, 56 * S), 'PK(기본키)', font=F(10), fill=GREY)
lx += 15 + d.textlength('PK(기본키)', font=F(10)) / S + 18
d.ellipse([lx * S, 58 * S, (lx + 9) * S, 67 * S], fill=FK)
d.text(((lx + 15) * S, 56 * S), 'FK(외래키)', font=F(10), fill=GREY)

# ===== 상단 행: 규칙·요율표 계열 (y=90)
TY = 90
entity('SCOPE', 40, TY, 250, 'FEE_RULE_SCOPE', '적용범위 (어디에)', [
    ('rule_id', 'pk'), ('asset_class', ''), ('exchanges', ''), ('sessions', ''),
    ('channels', ''), ('products', ''), ('exclude_products', '')], H_RULE)
entity('RULE', 330, TY, 250, 'FEE_RULE', '규칙 (정책 1건)', [
    ('rule_id', 'pk'), ('name / type[BASE·EVENT]', ''), ('status / apply_mode', ''),
    ('start_date / end_date', ''), ('benefit_kind / months', ''), ('target_account_ids', ''),
    ('schedule_id', 'fk')], H_RULE)
entity('SCHED', 620, TY, 250, 'FEE_SCHEDULE', '요율표 (얼마)', [
    ('schedule_id', 'pk'), ('name', '')], H_SCHED)
entity('COMP', 910, TY, 250, 'FEE_COMPONENT', '구성요소', [
    ('schedule_id', 'fk'), ('seq', 'pk'), ('kind[자사·유관기관·세금]', ''),
    ('payer[고객·회사·면제]', ''), ('rate_type[정률·정액·구간표]', ''), ('rate_bp / flat / min_fee', '')], H_SCHED)
entity('BAND', 1200, TY, 250, 'FEE_RATE_BAND', '구간 (구간표)', [
    ('schedule_id·seq', 'fk'), ('band_seq', 'pk'), ('from / to', ''), ('rate_bp / flat', '')], H_SCHED)

# ===== 계좌 단위 컨테이너 배경 (QUALIFY_POLICY는 제외 — 참조 데이터)
BY = 470
d.rounded_rectangle([312 * S, (BY - 34) * S, 1472 * S, (BY + 190) * S], radius=12 * S,
                    outline=(200, 175, 140), width=2 * S)
d.text((324 * S, (BY - 28) * S), '계좌 단위 데이터 (공통 키: account_id)', font=F(11, 5), fill=H_ACCT)

entity('ENROLL', 330, BY, 250, 'ENROLLMENT', '가입/신청 이력', [
    ('account_id', 'pk'), ('rule_id', 'fk'), ('enrolled_at', ''), ('channel', '')], H_ACCT)
entity('NEGO', 620, BY, 250, 'NEGO_GRANT', '협의 (계좌 부여)', [
    ('account_id', 'pk'), ('schedule_id', 'fk'), ('scope(asset_class…)', ''),
    ('valid_from / valid_to', ''), ('status[요청·활성·반려]', ''), ('qualify[충족·예외]', '')], H_ACCT)
entity('METRIC', 910, BY, 250, 'ACCOUNT_METRIC', '계좌 지표', [
    ('account_id', 'pk'), ('avg_asset_6m', ''), ('volume_6m', ''), ('dormant_returned / grade', '')], H_ACCT)
entity('CACHE', 1200, BY, 250, 'RESOLVED_CACHE', '해석 캐시', [
    ('account_id · fee_key', 'pk'), ('schedule_id', 'fk'), ('source_rule_id', 'fk'),
    ('source[협의·이벤트·기본]', ''), ('computed_at', '')], H_REF)

# ===== 참조 데이터 (좌하단)
entity('QUAL', 40, BY, 250, 'QUALIFY_POLICY', '자격 정책 (참조)', [
    ('asset_class', 'pk'), ('metric[평균자산·약정액]', ''), ('threshold', '')], H_REF)

# ================= 관계선 =================
# 1) SCOPE 1:1 RULE (규칙이 소유)
p1, p2 = right('SCOPE'), left('RULE')
line(p1, p2); onebar(p1, math.pi); onebar(p2, 0)
label(((p1[0] + p2[0]) / 2, p1[1] - 12), '1 : 1  소유')

# 2) RULE N:1 SCHED (요율표 참조·공유)
p1, p2 = right('RULE'), left('SCHED')
line(p1, p2); crow(p1, math.pi); onebar(p2, 0)
label(((p1[0] + p2[0]) / 2, p1[1] - 12), 'N : 1  참조(공유)')

# 3) SCHED 1:N COMP
p1, p2 = right('SCHED'), left('COMP')
line(p1, p2); onebar(p1, math.pi); crow(p2, 0)
label(((p1[0] + p2[0]) / 2, p1[1] - 12), '1 : N')

# 4) COMP 1:N BAND
p1, p2 = right('COMP'), left('BAND')
line(p1, p2); onebar(p1, math.pi); crow(p2, 0)
label(((p1[0] + p2[0]) / 2, p1[1] - 12), '1 : N')

# 5) ENROLL N:1 RULE (수직)
p1, p2 = topc('ENROLL'), botc('RULE')
line(p1, p2); crow(p1, -math.pi / 2); onebar(p2, math.pi / 2)
label(((p1[0] + p2[0]) / 2 + 22, (p1[1] + p2[1]) / 2), 'N : 1')

# 6) NEGO N:1 SCHED (수직)
p1, p2 = topc('NEGO'), botc('SCHED')
line(p1, p2); crow(p1, -math.pi / 2); onebar(p2, math.pi / 2)
label(((p1[0] + p2[0]) / 2 + 22, (p1[1] + p2[1]) / 2), 'N : 1')

# 7) METRIC ⋯ NEGO (자격 지표, dashed)
p1, p2 = left('METRIC', 30), right('NEGO', 30)
dline(p1, p2); label(((p1[0] + p2[0]) / 2, p1[1] - 10), '자격 지표')

# 8) QUAL ⋯ NEGO (자격 기준, dashed, 컨테이너 아래로 우회)
qb = botc('QUAL'); nb = botc('NEGO')
routeY = BY + 175
dline(qb, (qb[0], routeY)); dline((qb[0], routeY), (nb[0], routeY)); dline((nb[0], routeY), nb)
label(((qb[0] + nb[0]) / 2, routeY + 10), '자격 기준 (metric·threshold)')

# 9) CACHE ⋯ SCHED/RULE (해석 결과 저장, dashed)
p1 = topc('CACHE')
dline(p1, (p1[0], TY - 30)); dline((p1[0], TY - 30), (geom['SCHED'][0] + 200, TY - 30))
dline((geom['SCHED'][0] + 200, TY - 30), (geom['SCHED'][0] + 200, TY))
label((p1[0] - 20, TY - 42), '해석 결과 저장 (→ 요율표·규칙)')

img.save(OUT)
print('saved', OUT, img.size)
