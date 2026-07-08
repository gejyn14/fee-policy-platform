# -*- coding: utf-8 -*-
"""기술설계서 v1.6용 다이어그램 8종 (PIL, 한글, 2x 해상도).

v0 다이어그램(다이어그램_생성.py)과 같은 팔레트·스타일을 쓰되,
내용은 v1.6 설계(배정판 우대분만 저장, 조회키, 통합 랭킹, 3층 배치)를 따른다.

실행: python3 docs/scripts/다이어그램_v16_생성.py  (레포 루트 기준)
산출: docs/diagrams/v16_*.png
"""
import os, math
from PIL import Image, ImageDraw, ImageFont

S = 2  # scale
FONTPATH = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
OUT = '/Users/yujin-an/dev/fees/docs/diagrams'
os.makedirs(OUT, exist_ok=True)

def F(sz, idx=2):
    return ImageFont.truetype(FONTPATH, sz * S, index=idx)

def FB(sz):  # bold
    return ImageFont.truetype(FONTPATH, sz * S, index=5)

NAVY=(31,58,95); GREY=(96,96,102); WHITE=(255,255,255)
BLUE_F=(232,238,246); BLUE_O=(150,170,198)
GREEN_F=(223,242,231); GREEN_O=(120,180,150); GREEN_T=(31,110,80)
AMBER_F=(250,239,220); AMBER_O=(210,170,110); AMBER_T=(150,95,10)
GREY_F=(238,239,242); GREY_O=(180,182,190)
RED_T=(178,60,60); RED_F=(248,230,228); RED_O=(210,150,140)

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
        tcolor=NAVY, bcolor=GREY, tsz=17, bsz=13, radius=14, bold=True):
    x,y,w,h = x*S,y*S,w*S,h*S
    d.rounded_rectangle([x,y,x+w,y+h], radius=radius*S, fill=fill, outline=outline, width=2*S)
    tf = FB(tsz) if bold else F(tsz)
    bf = F(bsz)
    tw = d.textlength(title, font=tf)
    if lines:
        cy = y + 12*S
    else:
        # 제목만 있으면 수직 중앙
        cy = y + (h - tsz*S*1.25)/2
    d.text((x + (w-tw)/2, cy), title, font=tf, fill=tcolor)
    if lines:
        yy = cy + tsz*S + 8*S
        for ln in lines:
            for sub in wrap(d, ln, bf, w-22*S):
                sw = d.textlength(sub, font=bf)
                d.text((x + (w-sw)/2, yy), sub, font=bf, fill=bcolor)
                yy += bsz*S + 5*S

def lbox(d, x, y, w, h, title, lines, fill=BLUE_F, outline=BLUE_O,
         tcolor=NAVY, bcolor=GREY, tsz=15, bsz=12, radius=10):
    """ERD풍: 제목줄 + 왼쪽 정렬 항목 목록."""
    X,Y,W,H = x*S,y*S,w*S,h*S
    d.rounded_rectangle([X,Y,X+W,Y+H], radius=radius*S, fill=fill, outline=outline, width=2*S)
    tf, bf = FB(tsz), F(bsz)
    tw = d.textlength(title, font=tf)
    d.text((X + (W-tw)/2, Y + 9*S), title, font=tf, fill=tcolor)
    ly = Y + 9*S + tsz*S + 7*S
    d.line([X+10*S, ly-3*S, X+W-10*S, ly-3*S], fill=outline, width=1*S)
    for ln in lines:
        for sub in wrap(d, ln, bf, W-26*S):
            d.text((X+13*S, ly+2*S), sub, font=bf, fill=bcolor)
            ly += bsz*S + 5*S
    return y + h

def arrow(d, p1, p2, color=NAVY, w=3, dash=False):
    P1=(p1[0]*S,p1[1]*S); P2=(p2[0]*S,p2[1]*S)
    if dash:
        total = math.hypot(P2[0]-P1[0], P2[1]-P1[1])
        n = max(int(total/(9*S)), 1)
        for i in range(0, n, 2):
            t0, t1 = i/n, min((i+1)/n, 1)
            d.line([(P1[0]+(P2[0]-P1[0])*t0, P1[1]+(P2[1]-P1[1])*t0),
                    (P1[0]+(P2[0]-P1[0])*t1, P1[1]+(P2[1]-P1[1])*t1)],
                   fill=color, width=w*S)
    else:
        d.line([P1,P2], fill=color, width=w*S)
    a=math.atan2(P2[1]-P1[1], P2[0]-P1[0]); sz=11*S
    d.polygon([P2,
               (P2[0]-sz*math.cos(a-0.45), P2[1]-sz*math.sin(a-0.45)),
               (P2[0]-sz*math.cos(a+0.45), P2[1]-sz*math.sin(a+0.45))], fill=color)

def dline(d, p1, p2, color=GREY, w=2):
    """점선 세그먼트(화살촉 없음)."""
    P1=(p1[0]*S,p1[1]*S); P2=(p2[0]*S,p2[1]*S)
    total = math.hypot(P2[0]-P1[0], P2[1]-P1[1])
    n = max(int(total/(9*S)), 1)
    for i in range(0, n, 2):
        t0, t1 = i/n, min((i+1)/n, 1)
        d.line([(P1[0]+(P2[0]-P1[0])*t0, P1[1]+(P2[1]-P1[1])*t0),
                (P1[0]+(P2[0]-P1[0])*t1, P1[1]+(P2[1]-P1[1])*t1)],
               fill=color, width=w*S)

def alabel(d, x, y, text, color=GREY, sz=12, anchor='mm', bg=WHITE):
    f = F(sz)
    tw = d.textlength(text, font=f)
    X, Y = x*S, y*S
    if anchor == 'mm':
        X -= tw/2
    Y -= sz*S/2
    pad = 3*S
    d.rectangle([X-pad, Y-pad, X+tw+pad, Y+sz*S+pad], fill=bg)
    d.text((X, Y), text, font=f, fill=color)

def title(d, w, text, sub=None):
    f = FB(21)
    tw = d.textlength(text, font=f)
    d.text(((w*S-tw)/2, 18*S), text, font=f, fill=NAVY)
    if sub:
        sf = F(13)
        sw = d.textlength(sub, font=sf)
        d.text(((w*S-sw)/2, 18*S + 27*S), sub, font=sf, fill=GREY)

def zone(d, x, y, w, h, label, color=GREY_O, tcolor=GREY):
    X,Y,W,H = x*S,y*S,w*S,h*S
    d.rounded_rectangle([X,Y,X+W,Y+H], radius=16*S, outline=color, width=2*S)
    f = FB(14)
    d.rectangle([X+16*S, Y-9*S, X+16*S+d.textlength(label,font=f)+12*S, Y+11*S], fill=WHITE)
    d.text((X+22*S, Y-8*S), label, font=f, fill=tcolor)


# ──────────────────────────────────────────────────────────────
# 1. 전체 아키텍처: 정책은 저장, 배정판은 사전 산출 (§1)
# ──────────────────────────────────────────────────────────────
def g1():
    W,H = 1280, 640
    img,d = canvas(W,H)
    title(d, W, '전체 아키텍처: 정책은 저장, 배정판은 사전 산출',
          '계좌×품목 전개 저장 없이, 정책만 저장하고 계좌별 배정판을 미리 채운다')

    # 플랫폼 영역
    zone(d, 30, 100, 390, 460, '수수료 정책 플랫폼', BLUE_O, NAVY)
    box(d, 55, 125, 340, 66, '등록 → 검증 → 승인 → 활성',
        ['지배관계 검증 · 역마진 경고 · 심사 결재'], tsz=15, bsz=12)
    box(d, 55, 210, 340, 92, '정책(규칙)',
        ['기본 · 이벤트 · 협의(표준 등급)', '적용범위 · 기간 · 대상편입방식'], tsz=15, bsz=12)
    box(d, 55, 320, 160, 84, '요율표',
        ['구성요소 · 구간', '기본·이벤트·협의 공유'], tsz=14, bsz=11)
    box(d, 235, 320, 160, 84, '편입내역',
        ['협의 승인 · 이벤트 가입', '계좌 단위 기록'], tsz=14, bsz=11)
    box(d, 55, 440, 340, 92, '계좌 지표', ['6개월 평균자산 · 약정액 · 휴면복귀',
        '원장이 정기 배치로 적재'], fill=GREY_F, outline=GREY_O, tsz=14, bsz=12)

    # 배치 영역
    zone(d, 460, 100, 360, 460, '배정판 산출 (배치)', GREEN_O, GREEN_T)
    box(d, 485, 140, 310, 96, '일배치 전체 재산출',
        ['매일 1회, 장 마감 후', '셀별 승자 확정 → 변경분만 반영'],
        fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T, tsz=15, bsz=12)
    box(d, 485, 256, 310, 96, '수시 증분',
        ['정책 승인 · 협의 승인/연장 · 가입 · 휴면복귀', '해당 계좌 셀만 당일 갱신'],
        fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T, tsz=15, bsz=12)
    box(d, 485, 400, 310, 132, '수수료 배정판',
        ['계좌×조회조건별 승자 요율표', '우대분(이벤트·협의)만 저장', '기본이 이기는 셀은 행 없음'],
        fill=(255,251,235), outline=AMBER_O, tcolor=AMBER_T, tsz=17, bsz=12)

    # 원장 영역
    zone(d, 860, 100, 390, 460, '원장', AMBER_O, AMBER_T)
    box(d, 885, 130, 340, 60, '체결 발생',
        ['자산군·거래소·조회구분·세션·품목·채널'],
        fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T, tsz=15, bsz=11)
    box(d, 885, 216, 340, 62, '배정판 한 줄 조회',
        ['계좌번호 + 조회키'],
        fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T, tsz=15, bsz=12)
    box(d, 885, 304, 340, 66, '행 있으면 우대, 없으면 기본',
        ['미스가 대다수 · 정상 경로'],
        fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T, tsz=15, bsz=12)
    box(d, 885, 396, 340, 60, '요율표 평가 → 수수료 부과',
        ['자사 · 유관기관 · 세금'],
        fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T, tsz=15, bsz=12)
    box(d, 885, 482, 340, 50, '계좌 지표 산정 · 신호 발생',
        fill=GREY_F, outline=GREY_O, tsz=13)

    # 흐름
    arrow(d, (255,302), (255,320))              # 정책→요율표/부여
    arrow(d, (395,255), (460,255))
    alabel(d, 428, 240, '로드')
    arrow(d, (640,236), (640,256))
    arrow(d, (640,352), (640,400))
    arrow(d, (820,440), (900,440), color=AMBER_T)   # 판 → 원장(요율표 반환)
    arrow(d, (885,247), (820,430), color=AMBER_T, dash=True)
    alabel(d, 830, 330, '점조회(1ms 안쪽)', color=AMBER_T)
    arrow(d, (1055,190), (1055,216))
    arrow(d, (1055,278), (1055,304))
    arrow(d, (1055,370), (1055,396))
    arrow(d, (1055,456), (1055,482))
    # 원장 → 플랫폼 지표 적재 (아래 여백으로 우회)
    dline(d, (1055,532), (1055,592), color=GREY)
    dline(d, (1055,592), (220,592), color=GREY)
    arrow(d, (220,592), (220,532), color=GREY, dash=True, w=2)
    alabel(d, 640, 612, '계좌 지표 적재 · 가입/휴면복귀 신호 (원장 → 플랫폼)', color=GREY)

    img.save(f'{OUT}/v16_1_아키텍처.png')

# ──────────────────────────────────────────────────────────────
# 2. 데이터 모델 관계도 (§2)
# ──────────────────────────────────────────────────────────────
def g2():
    W,H = 1280, 720
    img,d = canvas(W,H)
    title(d, W, '데이터 모델: 요율표 + 정책 + 계좌 계열 + 산출물',
          '계좌마다 저장되는 것은 편입내역와 배정판뿐, 계좌×품목 전개 테이블은 없다')

    # 요율 계열 (왼쪽 위)
    zone(d, 30, 110, 300, 320, '요율 계열', BLUE_O, NAVY)
    lbox(d, 50, 135, 260, 74, '요율표', ['요율표ID · 요율표명'])
    lbox(d, 50, 232, 260, 90, '요율 구성요소',
         ['종류(자사/유관기관/세금)', '부담주체 · 요율방식 · 요율(bp)'])
    lbox(d, 50, 345, 260, 70, '요율 구간', ['구간번호 · 하한 · 상한 · 요율'])
    arrow(d, (180,209), (180,232)); alabel(d, 196, 220, '1:N')
    arrow(d, (180,322), (180,345)); alabel(d, 196, 333, '1:N (구간표만)')

    # 정책 계열 (가운데 위)
    zone(d, 370, 110, 330, 320, '정책 계열', GREEN_O, GREEN_T)
    lbox(d, 390, 135, 290, 128, '정책(규칙)',
         ['정책종류(기본/이벤트/협의) · 상태', '대상편입방식(일괄/신청/가입/휴면복귀)',
          '시작일 · 종료일 · 적용기간방식', '요율표 참조'],
         fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T)
    lbox(d, 390, 300, 290, 96, '적용범위',
         ['자산군 · 거래소 · 세션 · 채널', '품목 · 제외품목("전체" 허용)'],
         fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T)
    arrow(d, (535,263), (535,300), color=GREEN_T); alabel(d, 551, 281, '1:N', color=GREEN_T)
    arrow(d, (390,190), (310,175), color=GREY, dash=True)
    alabel(d, 350, 158, '요율표 참조', color=GREY)

    # 계좌 계열 (오른쪽 위)
    zone(d, 740, 110, 510, 320, '계좌 계열', GREY_O, GREY)
    lbox(d, 760, 135, 300, 118, '편입내역',
         ['계좌번호 · 정책ID', '상태(요청/활성/반려/만료)', '시작일 · 종료일 · 자격구분 · 승인자'],
         fill=GREY_F, outline=GREY_O)
    lbox(d, 760, 288, 300, 96, '계좌 지표',
         ['6개월평균자산 · 6개월약정액', '휴면복귀여부 · 등급 (원장 적재)'],
         fill=GREY_F, outline=GREY_O)
    lbox(d, 1085, 135, 145, 118, '자격 기준',
         ['자산군 · 지표', '임계값'], fill=GREY_F, outline=GREY_O)
    arrow(d, (760,185), (680,180), color=GREY, dash=True)
    alabel(d, 722, 163, 'N:1 정책', color=GREY)
    arrow(d, (1085,330), (1060,330), color=GREY, dash=True)
    alabel(d, 1150, 300, '자격 판정 시 비교', color=GREY)
    arrow(d, (1150,253), (1150,290), color=GREY, dash=True)

    # 산출물 (아래)
    zone(d, 30, 480, 1220, 215, '산출물 (배치가 쓰고 원장이 읽음)', AMBER_O, AMBER_T)
    lbox(d, 60, 515, 560, 150, '수수료 배정판',
         ['계좌번호 · 자산군 · 거래소 · 조회구분 · 품목코드 · 주문채널',
          '적용시작일 · 적용종료일',
          '요율표 · 적용정책 · 정책구분(기본/이벤트/협의) · 사유',
          '※ 우대분만 저장. 원장이 체결 시 읽는 대상'],
         fill=(255,251,235), outline=AMBER_O, tcolor=AMBER_T)
    lbox(d, 660, 515, 560, 150, '배정 이력',
         ['계좌번호 · 자산군 · 조회구분',
          '(이전 → 이후) 요율표 · 적용정책 · 정책구분',
          '변경사유 · 변경계기 · 변경시각',
          '※ 언제 왜 수수료가 바뀌었나 추적(민원 대응)'],
         fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T)
    arrow(d, (340,430), (340,515), color=AMBER_T)
    alabel(d, 340, 462, '셀별 승자 산출(배치)', color=AMBER_T)
    arrow(d, (620,590), (660,590), color=AMBER_T)
    alabel(d, 640, 573, '변경분', color=AMBER_T)

    img.save(f'{OUT}/v16_2_데이터모델.png')

# ──────────────────────────────────────────────────────────────
# 3. 체결 시 수수료 결정 흐름 (§6)
# ──────────────────────────────────────────────────────────────
def g3():
    W,H = 1280, 700
    img,d = canvas(W,H)
    title(d, W, '개별 체결의 수수료 결정: 원장은 배정판에서 한 줄만 읽는다',
          '우선순위 계산은 배정판에 이미 반영되어 있어 체결 시점에는 계산이 없다')

    y = 110
    box(d, 60, y, 220, 110, '① 체결 발생',
        ['자산군 · 거래소 · 조회구분', '세션 · 품목 · 채널', '(+ 체결가 · 수량)'],
        fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T, tsz=15, bsz=12)
    box(d, 340, y, 200, 110, '② 조회키 구성',
        ['체결 정보만으로 구성', '계좌·체결가·수량 제외'], tsz=15, bsz=12)
    box(d, 600, y, 220, 110, '③ 배정판 조회',
        ['계좌번호 + 조회키', '점조회 1ms 안쪽'], tsz=15, bsz=12)
    arrow(d, (280,y+55), (340,y+55))
    arrow(d, (540,y+55), (600,y+55))

    # 분기 다이아몬드 (③ 아래)
    cx, cy, dx, dy = 710, 330, 80, 48
    arrow(d, (710,220), (710,278))
    d.polygon([(cx*S,(cy-dy)*S), ((cx+dx)*S,cy*S), (cx*S,(cy+dy)*S), ((cx-dx)*S,cy*S)],
              fill=GREY_F, outline=GREY_O, width=2*S)
    f = FB(15)
    t = '행 있음?'
    d.text(((cx*S - d.textlength(t,font=f)/2), (cy-9)*S), t, font=f, fill=NAVY)

    box(d, 880, 240, 300, 90, '우대 요율표',
        ['이벤트 · 협의 승자', '(배정판이 답을 이미 앎)'],
        fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T, tsz=15, bsz=12)
    box(d, 880, 380, 300, 90, '기본 요율표 직접 적용',
        ['미스가 대다수 · 정상 경로', '자산군·조회구분으로 결정'],
        fill=GREY_F, outline=GREY_O, tsz=15, bsz=12)
    arrow(d, (792,330), (880,280), color=GREEN_T)
    alabel(d, 828, 282, '예 (우대)', color=GREEN_T)
    arrow(d, (792,330), (880,428), color=GREY)
    alabel(d, 826, 405, '아니오 (기본)', color=GREY)

    box(d, 880, 540, 300, 100, '④ 요율표 평가',
        ['정률 / 정액 / 구간표', '자사 · 유관기관 · 세금 금액 산출'],
        fill=BLUE_F, outline=BLUE_O, tsz=15, bsz=12)
    box(d, 480, 540, 300, 100, '⑤ 부과 · 잔고 반영',
        ['고객부과 합계 청구', '회사부담은 역마진 관리'],
        fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T, tsz=15, bsz=12)

    # 기본 → ④ (수직), 우대 → ④ (오른쪽 우회 버스)
    arrow(d, (1030,470), (1030,540))
    d.line([(1180*S,285*S),(1225*S,285*S),(1225*S,590*S)], fill=NAVY, width=3*S)
    arrow(d, (1225,590), (1180,590))
    alabel(d, 1225, 440, '선택된 요율표', color=GREY)
    arrow(d, (880,590), (780,590))

    img.save(f'{OUT}/v16_3_결정흐름.png')

# ──────────────────────────────────────────────────────────────
# 4. 우선순위: 통합 랭킹 + 자격 게이트 (§5)
# ──────────────────────────────────────────────────────────────
def g4():
    W,H = 1280, 700
    img,d = canvas(W,H)
    title(d, W, '수수료 우선순위: 세 정책이 한 순위에서 경쟁',
          '예시: 계좌 8041-2237-01의 해외파생 ES 선물 셀 (2등급 협의 보유)')

    # 후보 스택
    zone(d, 40, 110, 330, 420, '후보 정책 (요율 순)', BLUE_O, NAVY)
    box(d, 65, 140, 280, 78, '협의 3등급 $0.50',
        ['가장 싸지만 이 계좌엔 편입 없음'], tsz=15, bsz=12)
    box(d, 65, 240, 280, 78, '협의 2등급 $0.80',
        ['이 계좌에 활성 편입 있음'], fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T, tsz=15, bsz=12)
    box(d, 65, 340, 280, 78, '이벤트 (범위 밖)',
        ['이 셀에는 해당 이벤트 없음'], fill=GREY_F, outline=GREY_O, tsz=15, bsz=12)
    box(d, 65, 440, 280, 66, '해외파생 기본 $2.50',
        ['항상 후보'], fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T, tsz=15, bsz=12)

    # 게이트
    zone(d, 430, 110, 360, 420, '자격 게이트 (계좌별 판정)', GREY_O, GREY)
    box(d, 455, 145, 310, 100, '기본: 항상 통과', None,
        fill=GREY_F, outline=GREY_O, tsz=15)
    box(d, 455, 265, 310, 110, '이벤트',
        ['대상 판정(신청/가입/휴면복귀/일괄)', 'AND 기간 판정(캘린더/상대)'],
        fill=GREY_F, outline=GREY_O, tsz=15, bsz=12)
    box(d, 455, 395, 310, 110, '협의',
        ['편입내역가 "활성"이고', '오늘이 유효기간 안'],
        fill=GREY_F, outline=GREY_O, tsz=15, bsz=12)

    # 정렬 규칙
    zone(d, 850, 110, 390, 420, '정렬 규칙 (동률 시 아래로)', GREEN_O, GREEN_T)
    steps = [('1  요율 최저', '구조 그룹 순위값이 가장 낮은 정책'),
             ('2  계층', '협의 > 이벤트 > 기본'),
             ('3  적용범위 구체성', '더 좁게 겨냥한 정책 우선'),
             ('4  정책ID', '언제 조회해도 같은 결과(결정성)')]
    yy = 145
    for t, s in steps:
        box(d, 875, yy, 340, 74, t, [s],
            fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T, tsz=15, bsz=12)
        if yy > 145: arrow(d, (1045, yy-22), (1045, yy), color=GREEN_T, w=2)
        yy += 96

    # 판정 결과: 3등급은 협의 게이트에서 탈락(X), 2등급은 통과
    d.line([(345*S, 179*S), (455*S, 445*S)], fill=RED_O, width=2*S)
    d.line([(428*S,410*S),(448*S,430*S)], fill=RED_T, width=3*S)
    d.line([(448*S,410*S),(428*S,430*S)], fill=RED_T, width=3*S)
    alabel(d, 398, 415, '탈락', color=RED_T, sz=14)
    arrow(d, (345,279), (455,445), color=GREEN_T, dash=True)
    alabel(d, 400, 300, '통과', color=GREEN_T, sz=14)

    # 결과
    box(d, 430, 580, 480, 80, '셀 승자: 협의 2등급 $0.80',
        ['3등급이 더 싸도 편입이 없으면 탈락. 협의 적용은 편입내역으로 판정'],
        fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T, tsz=17, bsz=12)
    arrow(d, (610,530), (610,580), color=GREEN_T)
    arrow(d, (1045,530), (730,585), color=GREEN_T, dash=True)

    alabel(d, 640, 675, '협의가 무조건 우선은 아님. 이벤트가 협의보다 싸면 이벤트가 이김(고객 유리 원칙)',
           color=GREY, sz=13)

    img.save(f'{OUT}/v16_4_우선순위.png')

# ──────────────────────────────────────────────────────────────
# 5. 협의 편입내역 상태 전이 (§9)
# ──────────────────────────────────────────────────────────────
def g5():
    W,H = 1280, 560
    img,d = canvas(W,H)
    title(d, W, '협의수수료 편입내역: 요청 → 활성 → 연장 반복',
          '협의는 표준 등급 규칙, 계좌별 적용은 편입내역의 상태로 표현')

    box(d, 40, 150, 270, 130, '신청 (고객/PB)',
        ['자격 자동판정: 계좌 지표 vs 임계값', '미충족 시 영업예외로 신청 가능',
         '표준 등급 요율표 상속·조정'], tsz=16, bsz=12)
    box(d, 380, 150, 200, 90, '요청',
        ['요청번호로 묶여', '승인함에 대기'], fill=GREY_F, outline=GREY_O, tsz=17, bsz=12)
    box(d, 660, 150, 250, 110, '활성',
        ['시작일 = 승인일', '종료일 = 승인일 + 1년', '배정판 증분 갱신'],
        fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T, tsz=17, bsz=12)
    box(d, 1000, 150, 230, 90, '반려',
        ['거절 또는 연장 탈락', '(해지 대상)'], fill=RED_F, outline=RED_O, tcolor=RED_T, tsz=17, bsz=12)

    box(d, 590, 380, 390, 120, '연장 대상 산출 (정기 배치)',
        ['그룹 단위(주식형 상품군 / 파생 품목)로 재평가',
         '지표는 재계산 없이 최신 스냅샷 조회',
         '유지 → 종료일 연장 / 탈락 → 반려'],
        fill=BLUE_F, outline=BLUE_O, tsz=16, bsz=12)

    arrow(d, (310,205), (380,197))
    alabel(d, 345, 185, '협수 요청')
    arrow(d, (580,190), (660,190), color=GREEN_T)
    alabel(d, 620, 173, '승인', color=GREEN_T)
    # 요청 → 반려 (위쪽 여백으로 우회)
    dline(d, (480,150), (480,112), color=RED_T)
    dline(d, (480,112), (1115,112), color=RED_T)
    arrow(d, (1115,112), (1115,150), color=RED_T, dash=True, w=2)
    alabel(d, 800, 98, '반려', color=RED_T)
    # 활성 ↔ 연장 배치 (내려가는 만료 임박 / 올라오는 유지)
    arrow(d, (785,260), (785,380), color=NAVY, w=2)
    alabel(d, 838, 320, '만료 임박', color=GREY)
    arrow(d, (700,380), (700,260), color=GREEN_T, w=2)
    alabel(d, 620, 320, '유지: 종료일 연장', color=GREEN_T)
    # 탈락 → 반려
    arrow(d, (980,440), (1110,240), color=RED_T, dash=True)
    alabel(d, 1090, 350, '탈락', color=RED_T)

    img.save(f'{OUT}/v16_5_협의상태.png')

# ──────────────────────────────────────────────────────────────
# 6. 배정판 산출 3층 체제 (§10)
# ──────────────────────────────────────────────────────────────
def g6():
    W,H = 1280, 640
    img,d = canvas(W,H)
    title(d, W, '배정판 산출 3층 체제: 즉시성 · 날짜 롤오버 · 정합성',
          '판이 억 단위에 도달하면 매일 전체 재산출 대신 아래 3층으로 전환')

    rows = [
        ('① 수시 증분 (즉시)', ['계기: 신청 · 승인 · 연장 · 휴면복귀', '해당 계좌 셀만 갱신 → 당일 적용 보장'],
         GREEN_F, GREEN_O, GREEN_T),
        ('② 일 delta 배치 (초 단위)', ['날짜 경과로 승자가 바뀌는 셀만 재산출',
         '대상: 적용종료일이 전일인 행 + 당일 시작 정책의 범위 셀'],
         BLUE_F, BLUE_O, NAVY),
        ('③ 주기 전체 검증 (진본)', ['주 1회 전체 재산출·대조, 또는 계좌 1/N 순환 검증',
         '증분·delta 누락 보정 · 신규 계좌/품목 반영 · 대조 리포트',
         '키 정렬 순서 병렬 적재(direct-path). 2억 행 정렬 적재 6분 실측'],
         GREY_F, GREY_O, NAVY),
    ]
    y = 120
    for t, lines, f_, o_, tc in rows:
        box(d, 60, y, 640, 110, t, lines, fill=f_, outline=o_, tcolor=tc, tsz=17, bsz=12)
        arrow(d, (700, y+55), (790, y+55), color=tc)
        y += 140

    box(d, 790, 170, 300, 340, '수수료 배정판',
        ['계좌×조회조건별 승자', '우대분만 저장',
         '점조회는 행 수와 무관', '(2억 행에서도 1ms 안쪽)'],
        fill=(255,251,235), outline=AMBER_O, tcolor=AMBER_T, tsz=19, bsz=13)

    box(d, 1130, 170, 120, 340, '원장', ['체결 시', '점조회'],
        fill=AMBER_F, outline=AMBER_O, tcolor=AMBER_T, tsz=17, bsz=12)
    arrow(d, (1130,340), (1090,340), color=AMBER_T)

    box(d, 60, 545, 1030, 60, '세 층이 같은 승자 확정 함수를 공유 (로직은 한 벌)',
        None, fill=WHITE, outline=GREY_O, tsz=15)

    img.save(f'{OUT}/v16_6_배치3층.png')

# ──────────────────────────────────────────────────────────────
# 7. 정책 등록 → 활성 수명주기 (§11)
# ──────────────────────────────────────────────────────────────
def g7():
    W,H = 1280, 470
    img,d = canvas(W,H)
    title(d, W, '정책 수명주기: 기안 → 검증 → 승인 → 활성',
          '활성 이후에는 계좌별 전개 없이 배정판 산출로 적용')

    y = 130
    box(d, 40, y, 230, 120, '기안 (현업)',
        ['적용범위(상품군·거래소·', '조회구분·채널, 파생은 품목)', '요율표 · 기간 · 대상'],
        tsz=16, bsz=12)
    box(d, 330, y, 270, 120, '자동 검증',
        ['지배관계: 기준선을 전 가격구간', '에서 하회하는지 점검(가짜 우대 차단)',
         '역마진: 회사부담 > 자사 수취분 경고'], tsz=16, bsz=12)
    box(d, 660, y, 200, 120, '승인대기',
        ['심사자가 시뮬레이션·', '경고 확인 후 결재'],
        fill=GREY_F, outline=GREY_O, tsz=16, bsz=12)
    box(d, 920, y, 150, 54, '활성', None,
        fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T, tsz=17)
    box(d, 920, y+76, 150, 44, '반려', None,
        fill=RED_F, outline=RED_O, tcolor=RED_T, tsz=15)
    box(d, 1000, 320, 240, 100, '활성 후처리',
        ['우선순위 순위 갱신', '영향 범위 배정판 증분 산출'],
        fill=GREEN_F, outline=GREEN_O, tcolor=GREEN_T, tsz=16, bsz=12)

    arrow(d, (270,y+60), (330,y+60)); alabel(d, 300, y+43, '상신')
    arrow(d, (600,y+60), (660,y+60))
    arrow(d, (860,y+35), (920,y+27), color=GREEN_T); alabel(d, 890, y+12, '승인', color=GREEN_T)
    arrow(d, (860,y+85), (920,y+98), color=RED_T); alabel(d, 890, y+110, '반려', color=RED_T)
    arrow(d, (995,y+54), (1090,320), color=GREEN_T)

    alabel(d, 640, 435, '주식은 종목 단위 우대가 없어 적용범위·시뮬레이션도 거래소×조회구분×채널 단위. 종목별 지정은 파생만',
           color=GREY, sz=13)

    img.save(f'{OUT}/v16_7_수명주기.png')

# ──────────────────────────────────────────────────────────────
# 8. 이벤트 두 기간: 신청 가능기간 vs 적용기간 (§8)
# ──────────────────────────────────────────────────────────────
def g8():
    W,H = 1280, 560
    img,d = canvas(W,H)
    title(d, W, '이벤트의 두 기간: 신청 가능기간과 적용기간은 다르다',
          '예시: 신청 가능기간 7/1~9/30, 상대형은 가입일 + 3개월')

    # 시간축
    x0, x1 = 160, 1180
    months = ['7월','8월','9월','10월','11월','12월']
    axy = 140
    d.line([(x0*S,axy*S),(x1*S,axy*S)], fill=GREY_O, width=2*S)
    step = (x1-x0)/6
    f = F(13)
    for i,m in enumerate(months):
        mx = x0 + step*i
        d.line([(mx*S,(axy-5)*S),(mx*S,(axy+5)*S)], fill=GREY_O, width=2*S)
        d.text(((mx+8)*S,(axy-24)*S), m, font=f, fill=GREY)
    def bar(row_y, bx0, bx1, label, fill, outline, tcolor):
        d.rounded_rectangle([bx0*S,row_y*S,(bx1)*S,(row_y+44)*S], radius=8*S,
                            fill=fill, outline=outline, width=2*S)
        bf = FB(14)
        tw = d.textlength(label, font=bf)
        cx = (bx0+bx1)/2*S - tw/2
        d.text((cx,(row_y+12)*S), label, font=bf, fill=tcolor)
    def rowlabel(row_y, text, color=NAVY):
        bf = FB(14)
        d.text((30*S,(row_y+12)*S), text, font=bf, fill=color)

    mth = step  # 1개월 픽셀
    # 신청 가능기간 7/1~9/30
    rowlabel(180, '신청 가능기간')
    bar(180, x0, x0+3*mth, '7/1 ~ 9/30 (들어올 수 있는 구간)', BLUE_F, BLUE_O, NAVY)

    # 캘린더 고정
    rowlabel(260, '캘린더 고정', GREEN_T)
    bar(260, x0, x0+6*mth-6, '모든 고객이 규칙 종료일(12/31)에 함께 종료', GREEN_F, GREEN_O, GREEN_T)

    # 상대형
    rowlabel(350, '상대(+3개월)', AMBER_T)
    bar(350, x0+0.3*mth, x0+3.3*mth, '고객 A: 7/10 가입 → 10/10 종료', AMBER_F, AMBER_O, AMBER_T)
    bar(415, x0+2.6*mth, x0+5.6*mth, '고객 B: 9/20 가입 → 12/20 종료', AMBER_F, AMBER_O, AMBER_T)

    # 신청 마감선
    mx = x0+3*mth
    for yy in range(150, 470, 14):
        d.line([(mx*S,yy*S),(mx*S,(yy+7)*S)], fill=RED_T, width=2*S)
    alabel(d, mx, 480, '신청 마감(9/30). 마감이 지나도 이미 가입한 고객의 잔여기간은 유지', color=RED_T, sz=13)

    alabel(d, 640, 530, '상대형은 가입일이 계좌마다 달라 종료일도 제각각. 계좌별 기간이 배정판의 적용시작일·적용종료일에 그대로 반영',
           color=GREY, sz=13)

    img.save(f'{OUT}/v16_8_이벤트기간.png')


if __name__ == '__main__':
    for fn in (g1,g2,g3,g4,g5,g6,g7,g8):
        fn()
        print('저장:', fn.__name__)
    print('완료:', OUT)
