# -*- coding: utf-8 -*-
"""업무 설계서용 다이어그램 7종 (PIL, 한글). 2x 해상도."""
import os, math
from PIL import Image, ImageDraw, ImageFont

S = 2  # scale
FONTPATH = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
OUT = '/Users/yujin-an/dev/fees/docs/diagrams'
os.makedirs(OUT, exist_ok=True)

def F(sz, idx=2):  # idx 2 ≈ Regular/Medium
    return ImageFont.truetype(FONTPATH, sz * S, index=idx)

NAVY=(31,58,95); GREY=(96,96,102); WHITE=(255,255,255)
BLUE_F=(232,238,246); BLUE_O=(150,170,198)
GREEN_F=(223,242,231); GREEN_O=(120,180,150); GREEN_T=(31,110,80)
AMBER_F=(250,239,220); AMBER_O=(210,170,110); AMBER_T=(150,95,10)
GREY_F=(238,239,242); GREY_O=(180,182,190)
RED_T=(178,60,60)

def canvas(w, h, bg=WHITE):
    img = Image.new('RGB', (w*S, h*S), bg)
    return img, ImageDraw.Draw(img)

def wrap(d, text, font, maxw):
    words = text.split(' ')
    lines, cur = [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=font) <= maxw or not cur:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur: lines.append(cur)
    return lines

def box(d, x, y, w, h, title, lines=None, fill=BLUE_F, outline=BLUE_O,
        tcolor=NAVY, bcolor=GREY, tsz=17, bsz=13, radius=14):
    x,y,w,h = x*S,y*S,w*S,h*S
    d.rounded_rectangle([x,y,x+w,y+h], radius=radius*S, fill=fill, outline=outline, width=2*S)
    tf, bf = F(tsz), F(bsz)
    # 제목
    tw = d.textlength(title, font=tf)
    cy = y + 14*S if lines else y + (h - tsz*S)/2
    d.text((x + (w-tw)/2, cy), title, font=tf, fill=tcolor)
    if lines:
        yy = cy + tsz*S + 8*S
        for ln in lines:
            for sub in wrap(d, ln, bf, w-24*S):
                sw = d.textlength(sub, font=bf)
                d.text((x + (w-sw)/2, yy), sub, font=bf, fill=bcolor)
                yy += bsz*S + 5*S

def arrow(d, p1, p2, color=NAVY, w=3):
    p1=(p1[0]*S,p1[1]*S); p2=(p2[0]*S,p2[1]*S)
    d.line([p1,p2], fill=color, width=w*S)
    a=math.atan2(p2[1]-p1[1], p2[0]-p1[0]); sz=11*S
    d.polygon([p2,
               (p2[0]-sz*math.cos(a-0.45), p2[1]-sz*math.sin(a-0.45)),
               (p2[0]-sz*math.cos(a+0.45), p2[1]-sz*math.sin(a+0.45))], fill=color)

def label(d, x, y, text, sz=12, color=GREY, center=False, font=None):
    f = font or F(sz)
    if center:
        x = x - d.textlength(text, font=f)/(2*S)
    d.text((x*S, y*S), text, font=f, fill=color)

def save(img, name):
    img.save(f'{OUT}/{name}.png')
    print('saved', name, img.size)

# ============================================================ D1 업무 프로세스
img, d = canvas(860, 360)
label(d, 30, 20, '[그림 1] 이벤트 등록 → 승인 → 체결 적용 흐름', sz=15, color=NAVY)
bw, bh, gap, y = 140, 84, 26, 80
xs = [30 + i*(bw+gap) for i in range(5)]
data = [
    ('① 현업 기안', ['적용범위·요율표', '기간 설정'], BLUE_F, BLUE_O),
    ('② 시뮬레이션', ['지배관계·역마진', '검증'], BLUE_F, BLUE_O),
    ('③ 심사 승인', ['검토 후 승인'], BLUE_F, BLUE_O),
    ('④ 활성', ['사전 전개 없음'], GREEN_F, GREEN_O),
    ('⑤ 체결 시 해석', ['최저가 자동 적용'], GREEN_F, GREEN_O),
]
for (t, l, f, o), x in zip(data, xs):
    box(d, x, y, bw, bh, t, l, fill=f, outline=o, tcolor=(NAVY if f==BLUE_F else GREEN_T))
for i in range(4):
    arrow(d, (xs[i]+bw, y+bh/2), (xs[i+1], y+bh/2))
# 신청/가입 보조
box(d, xs[2], y+bh+52, bw*2+gap, 70, '신청형·가입형', ['고객이 신청·가입한 계좌만 대상 편입'],
    fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T)
arrow(d, (xs[3]+bw/2, y+bh+52), (xs[3]+bw/2, y+bh))
label(d, 30, 316, '핵심: 활성 이후 계좌마다 전개하지 않고, 체결 순간 규칙을 해석해 그 계좌에 가장 유리한 수수료를 자동 선택.', sz=13, color=GREY)
save(img, 'd1_process')

# ============================================================ D2 이벤트 기간 2축
img, d = canvas(820, 300)
label(d, 30, 20, '[그림 2] 이벤트 기간 — 신청 가능기간과 적용기간(혜택) 분리', sz=15, color=NAVY)
# 타임라인
tl_x0, tl_x1, ty = 60, 780, 90
# 신청 가능기간 바
d.rounded_rectangle([tl_x0*S, (ty)*S, (tl_x0+300)*S, (ty+30)*S], radius=6*S, fill=BLUE_F, outline=BLUE_O, width=2*S)
label(d, tl_x0+150, ty+7, '신청 가능기간 (4/1~6/30)', sz=13, color=NAVY, center=True)
# 캘린더 고정형
by=ty+70
d.rounded_rectangle([tl_x0*S, by*S, (tl_x0+300)*S, (by+28)*S], radius=6*S, fill=GREEN_F, outline=GREEN_O, width=2*S)
label(d, tl_x0+150, by+6, '캘린더 고정: 6/30까지', sz=12, color=GREEN_T, center=True)
label(d, tl_x0+320, by+5, '← 모두 같은 날 종료', sz=12, color=GREY)
# 상대형 (고객별)
cy=by+64
d.rounded_rectangle([(tl_x0+180)*S, cy*S, (tl_x0+180+330)*S, (cy+28)*S], radius=6*S, fill=AMBER_F, outline=AMBER_O, width=2*S)
label(d, tl_x0+180+165, cy+6, '상대형: 6/20 가입 → 8/20까지 무료', sz=12, color=AMBER_T, center=True)
label(d, tl_x0+180+340, cy+5, '← 신청 마감 지나도 유지', sz=12, color=GREY)
# 세로 기준선(6/30)
gx=tl_x0+300
d.line([(gx*S,(ty-6)*S),(gx*S,(cy+40)*S)], fill=(200,120,120), width=2*S)
label(d, gx-14, ty-24, '6/30', sz=11, color=RED_T)
label(d, 30, 250, '같은 이벤트라도 상대형은 고객별 가입일 기준이라 혜택 종료일이 다릅니다. 체결 시 해석이 이를 자동 반영.', sz=13, color=GREY)
save(img, 'd2_period')

# ============================================================ D3 데이터 구조 ERD
img, d = canvas(820, 420)
label(d, 30, 18, '[그림 3] 데이터 구조 (업무 관점)', sz=15, color=NAVY)
# 중앙: 규칙
box(d, 330, 70, 160, 74, '규칙(룰)', ['유형·상태·적용범위', '기간(2축)·조건'], fill=BLUE_F, outline=BLUE_O)
# 요율표
box(d, 330, 220, 160, 64, '요율표', ['자사·유관기관·세금'], fill=BLUE_F, outline=BLUE_O)
arrow(d, (410,144),(410,220)); label(d, 418, 175,'참조',sz=11)
# 적용범위(좌상)
box(d, 90, 70, 170, 64, '적용범위', ['상품군·거래소·세션', '채널 (파생=품목)'], fill=GREY_F, outline=GREY_O, tcolor=NAVY)
arrow(d,(260,102),(330,104))
# 협의 예외(우)
box(d, 560, 70, 180, 74, '협의 예외(계좌 부여)', ['계좌 × 요율표', '유효기간'], fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T)
arrow(d,(560,107),(490,107)); label(d,500,86,'계좌 단위 저장',sz=11,color=GREEN_T)
# 가입/신청 이력(우하)
box(d, 560, 220, 180, 64, '가입/신청 이력', ['계좌 × 규칙 · 가입일'], fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T)
arrow(d,(560,250),(490,180));
# 계좌 지표(좌하)
box(d, 90, 220, 170, 64, '계좌 지표', ['6개월 평균자산·약정액'], fill=GREY_F, outline=GREY_O, tcolor=NAVY)
arrow(d,(260,250),(330,250)); label(d,262,225,'자격 판정',sz=11)
# 해석 결과 보관(하단중앙)
box(d, 300, 330, 220, 60, '해석 결과 보관 (캐시)', ['계좌 × 조회키 → 답'], fill=(235,235,245), outline=(170,170,200), tcolor=NAVY)
arrow(d,(410,284),(410,330))
label(d, 30, 400, '“계좌×종목 전량 전개 테이블”은 두지 않음 — 계좌 단위 저장은 협의 예외뿐, 나머지는 규칙 해석+캐시.', sz=12, color=GREY)
save(img, 'd3_data')

# ============================================================ D4 적용 방식 3구분
img, d = canvas(820, 340)
label(d, 30, 18, '[그림 4] 적용 방식 구분 — 배치 / 신청·가입 / 시그널 즉시', sz=15, color=NAVY)
cols = [
    ('정기 배치', ['이벤트 발효·만료', '계좌 지표 재산정'], BLUE_F, BLUE_O, NAVY),
    ('고객 신청·가입', ['신청형·가입형 편입', '(신청·가입 즉시)'], AMBER_F, AMBER_O, AMBER_T),
    ('시그널 / 조회 시 즉시', ['휴면복귀 감지', '상대형 혜택 종료', '규칙변경→캐시 무효화'], GREEN_F, GREEN_O, GREEN_T),
]
cw, y = 240, 70
for i,(t,items,f,o,tc) in enumerate(cols):
    x = 30 + i*(cw+20)
    box(d, x, y, cw, 200, t, [], fill=f, outline=o, tcolor=tc, tsz=17)
    yy = y+56
    bf=F(13)
    for it in items:
        d.ellipse([(x+22)*S,(yy+6)*S,(x+28)*S,(yy+12)*S], fill=tc)
        d.text(((x+38)*S,yy*S), it, font=bf, fill=GREY)
        yy += 34
box(d, 30, y+220, cw*3+40, 44, '', [], fill=(248,248,250), outline=(220,220,225))
label(d, 40, y+232, '정기 배치가 꼭 필요한 것은 “기간 도래”와 “지표 재산정”. 협의 연장은 만료 임박 자동 산출→담당자 확인(요청형).', sz=12, color=GREY)
save(img, 'd4_apply')

# ============================================================ D5 아키텍처
img, d = canvas(860, 360)
label(d, 30, 18, '[그림 5] 아키텍처 — 규칙은 저장, 금액은 체결 때 해석', sz=15, color=NAVY)
# 플랫폼
box(d, 40, 70, 340, 210, '플랫폼', [], fill=BLUE_F, outline=BLUE_O, tsz=18)
for i,txt in enumerate(['규칙 등록·심사·승인','적용범위·기간 관리','체결 시 해석 (최저가)','협의 부여·연장','해석 결과 캐시·무효화']):
    label(d, 70, 118+i*30, '· '+txt, sz=13, color=NAVY)
# 원장
box(d, 440, 70, 340, 210, '원장', [], fill=GREEN_F, outline=GREEN_O, tsz=18, tcolor=GREEN_T)
for i,txt in enumerate(['체결 처리·잔고 반영','계좌 지표 산정·전달','해석 결과로 실제 수수료 부과']):
    label(d, 470, 130+i*34, '· '+txt, sz=13, color=(30,90,60))
# 양방향 화살표
arrow(d,(380,150),(440,150)); arrow(d,(440,200),(380,200))
label(d, 386, 128, '조회키', sz=11, color=GREY); label(d, 386, 205, '지표·체결', sz=11, color=GREY)
label(d, 30, 300, '규모 대응: 계좌×종목을 미리 펼치지 않고 규칙만 저장 → 체결 때 해석 + 캐시 + 증분 무효화.', sz=13, color=GREY)
label(d, 30, 326, '주식은 조회키에서 종목을 제거(거래소·세션·채널)해 카디널리티를 줄임. 파생만 품목 유지.', sz=13, color=GREY)
save(img, 'd5_arch')

# ============================================================ D6 체결 플로우
img, d = canvas(820, 470)
label(d, 30, 18, '[그림 6] 체결 시 수수료 적용 플로우', sz=15, color=NAVY)
steps = [
    ('① 체결 발생', '계좌·거래소·세션·채널·(파생)품목·체결가·수량 확정'),
    ('② 조회키 구성', '주식은 종목 붕괴 → 거래소·세션·채널'),
    ('③ 후보 수집', '협의·이벤트·기본 (편입·적용기간 통과분만)'),
    ('④ 최저가 결정', '고객 부담 최저 선택 → 답을 캐시 저장'),
    ('⑤ 금액 산정', '요율표 × 체결가·수량으로 즉석 계산'),
    ('⑥ 원장 반영', '수수료 구성 전달 → 실제 부과·잔고 반영'),
]
x, y0, bw, bh, vg = 250, 60, 320, 52, 14
for i,(t,dsc) in enumerate(steps):
    y=y0+i*(bh+vg)
    f = GREEN_F if i>=3 else BLUE_F
    o = GREEN_O if i>=3 else BLUE_O
    box(d, x, y, bw, bh, t, [dsc], fill=f, outline=o,
        tcolor=(GREEN_T if i>=3 else NAVY), tsz=15, bsz=11.5)
    if i<5:
        arrow(d,(x+bw/2,y+bh),(x+bw/2,y+bh+vg))
# 캐시 표시
label(d, x+bw+30, y0+3*(bh+vg)+10, '↩ 동일 조회는', sz=12, color=GREY)
label(d, x+bw+30, y0+3*(bh+vg)+28, '캐시 적중(재계산 없음)', sz=12, color=GREY)
save(img, 'd6_flow')

# ============================================================ D7 협의 연장 분류
img, d = canvas(820, 300)
label(d, 30, 18, '[그림 7] 협의수수료 연장 대상 산출 (그룹 단위)', sz=15, color=NAVY)
box(d, 40, 70, 220, 110, '만료 임박 협의 그룹', ['주식형 = 상품군', '파생 = 품목별'], fill=BLUE_F, outline=BLUE_O)
label(d, 150, 190, '조건 재평가', sz=12, color=GREY, center=True)
arrow(d,(260,110),(360,90)); arrow(d,(260,125),(360,145)); arrow(d,(260,140),(360,200))
box(d, 360, 62, 200, 52, '신규', ['새로 조건 충족'], fill=GREY_F, outline=GREY_O, tcolor=NAVY, tsz=15, bsz=11.5)
box(d, 360, 122, 200, 52, '유지 (연장)', ['계속 충족'], fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T, tsz=15, bsz=11.5)
box(d, 360, 182, 200, 52, '탈락', ['더는 미충족 → 해지'], fill=(250,232,232), outline=(210,150,150), tcolor=RED_T, tsz=15, bsz=11.5)
arrow(d,(560,148),(650,148))
box(d, 650, 110, 140, 76, '담당자', ['확인 후', '일괄 승인'], fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T)
label(d, 30, 258, '신청·승인은 계좌별, 연장은 그룹 단위로 대상을 한 번에 산출하고 기존 대비 탈락까지 함께 보여줌.', sz=13, color=GREY)
save(img, 'd7_nego')
print('DONE')

# ============================================================ D8 해석 상세
img, d = canvas(860, 600)
label(d, 30, 18, '[그림 8] 체결 해석 상세 — 후보 수집 · 게이트 · 최저가 · 캐시', sz=15, color=NAVY)
x, y0, bw, bh, vg = 60, 58, 420, 54, 12
steps = [
    ('① 조회키 구성', '상품군·거래소·세션·채널 (파생=품목)', BLUE_F, BLUE_O, NAVY),
    ('② 후보 인덱스 조회', '활성 이벤트·협의 중 적용범위 매칭', BLUE_F, BLUE_O, NAVY),
    ('③ 대상·기간 게이트', '신청/가입/휴면·조건 충족 + 적용기간 통과', AMBER_F, AMBER_O, AMBER_T),
    ('④ 협의 예외 결합', '계좌·유효기간 매칭 grant 추가', GREEN_F, GREEN_O, GREEN_T),
    ('⑤ 기본요율 결합', '상품군 BASE 항상 후보', BLUE_F, BLUE_O, NAVY),
    ('⑥ 최저가 선정', '공동 probe grid 평균 최소(동률 협의>이벤트>기본)', GREEN_F, GREEN_O, GREEN_T),
    ('⑦ 캐시 저장', '(계좌, 조회키) → 요율표·출처', (235,235,245), (170,170,200), NAVY),
]
anno = {2:'주식은 종목 붕괴', 5:'금액 미저장 — 요율표×체결 즉석 계산', 6:'이후 동일 조회 = 적중(재계산 없음)'}
for i,(t,dsc,f,o,tc) in enumerate(steps):
    y = y0 + i*(bh+vg)
    box(d, x, y, bw, bh, t, [dsc], fill=f, outline=o, tcolor=tc, tsz=15, bsz=11.5)
    if i < 6:
        arrow(d,(x+bw/2,y+bh),(x+bw/2,y+bh+vg))
    if i in anno:
        label(d, x+bw+24, y+bh/2-8, '← '+anno[i], sz=11.5, color=GREY)
save(img, 'd8_resolve')

# ============================================================ 스윔레인 헬퍼
def swimlane(d, x, y, w, lanes, lh, labw):
    centers = []
    for i, name in enumerate(lanes):
        y0 = y + i*lh
        fill = (246,247,250) if i % 2 == 0 else (238,240,245)
        d.rounded_rectangle([x*S, y0*S, (x+w)*S, (y0+lh)*S], radius=6*S, fill=fill, outline=(214,217,224), width=1*S)
        d.line([((x+labw)*S, y0*S), ((x+labw)*S, (y0+lh)*S)], fill=(214,217,224), width=1*S)
        f = F(13)
        tw = d.textlength(name, font=f)
        d.text(((x + (labw-tw)/2)*S, (y0 + lh/2 - 9)*S), name, font=f, fill=NAVY)
        centers.append(y0 + lh/2)
    return centers

# ============================================================ D9 시스템 업무 흐름(스윔레인)
img, d = canvas(1060, 560)
label(d, 30, 16, '[그림 9] 시스템 업무 흐름 — 정책 등록부터 체결 부과까지 (스윔레인)', sz=15, color=NAVY)
lanes = ['현업', '심사', '플랫폼(시스템)', '원장']
lx, ly0, lw, lh, labw = 30, 54, 1000, 110, 96
centers = swimlane(d, lx, ly0, lw, lanes, lh, labw)
bx0 = lx + labw + 14
bw, gap, bh = 118, 14, 66
xs = [bx0 + i*(bw+gap) for i in range(7)]
steps = [
    (0, '① 정책 기안', ['적용범위·요율표', '기간']),
    (2, '② 시뮬레이션', ['지배관계·역마진']),
    (1, '③ 승인/반려', ['심사 결재']),
    (2, '④ 활성화', ['우선순위 인덱스 갱신']),
    (3, '⑤ 체결 발생', ['계좌·조회키·체결가']),
    (2, '⑥ 해석', ['우선순위 룩업+협의', '금액 계산']),
    (3, '⑦ 부과', ['수수료·잔고 반영']),
]
def lane_style(l):
    return (GREEN_F, GREEN_O, GREEN_T) if l == 3 else ((AMBER_F, AMBER_O, AMBER_T) if l == 1 else (BLUE_F, BLUE_O, NAVY))
for i, (lane, t, lines) in enumerate(steps):
    f, o, tc = lane_style(lane)
    box(d, xs[i], centers[lane]-bh/2, bw, bh, t, lines, fill=f, outline=o, tcolor=tc, tsz=13.5, bsz=10.5)
for i in range(6):
    arrow(d, (xs[i]+bw, centers[steps[i][0]]), (xs[i+1], centers[steps[i+1][0]]))
# 등록 ↔ 체결 위상 구분선(④와 ⑤ 사이)
dvx = (xs[3]+bw + xs[4]) / 2
for yy in range(int(ly0), int(ly0+4*lh), 12):
    d.line([(dvx*S, yy*S), (dvx*S, (yy+6)*S)], fill=(205,165,120), width=2*S)
label(d, dvx-40, ly0-2, '활성 이후 · 체결 시', sz=10.5, color=(150,110,60))
save(img, 'd9_swimlane')

# ============================================================ D10 협의 신청·승인 흐름(스윔레인)
img, d = canvas(1000, 480)
label(d, 30, 16, '[그림 10] 협의수수료 신청·승인 흐름 (스윔레인)', sz=15, color=NAVY)
lanes2 = ['현업(PB)', '플랫폼(시스템)', '승인자', '원장']
c2 = swimlane(d, 30, 54, 940, lanes2, 100, 100)
bx = 30 + 100 + 16
bw2, gap2, bh2 = 150, 22, 62
xs2 = [bx + i*(bw2+gap2) for i in range(5)]
steps2 = [
    (0, '① 협의 신청', ['계좌 리스트·범위·요율']),
    (1, '② 자격 판정·요청 생성', ['정책 기준+bypass']),
    (2, '③ 승인/반려', ['요청 목록 확인']),
    (1, '④ 협의 활성', ['유효기간·캐시 무효화']),
    (3, '⑤ 체결 시 반영', ['해석에 협의 얹음']),
]
for i, (lane, t, lines) in enumerate(steps2):
    f, o, tc = lane_style(lane)
    box(d, xs2[i], c2[lane]-bh2/2, bw2, bh2, t, lines, fill=f, outline=o, tcolor=tc, tsz=13.5, bsz=10.5)
for i in range(4):
    arrow(d, (xs2[i]+bw2, c2[steps2[i][0]]), (xs2[i+1], c2[steps2[i+1][0]]))
save(img, 'd10_nego_flow')
print('SWIMLANES DONE')
