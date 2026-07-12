# -*- coding: utf-8 -*-
"""기술설계서 v1.8용 프로세스 도식 1종 (PIL, 한글, 2x 해상도).

한국식 컨설팅 프로세스 도식: 새 수수료 정책의 여정을 좌→우 5단계로 펼치고,
1차전(승인 때 사전 랭킹)에서 일어난 두 변화를 강조한다.
  ① 색인 키 4축 → 6축 완전 키화(+세션·채널)
  ② 1차전을 인메모리 배치 계산에서 물리 테이블(순위값 스탬프 + 후보 색인)로 이동

기존 다이어그램(다이어그램_v16_생성.py)과 같은 팔레트·폰트를 쓴다.
실행: python3 docs/scripts/다이어그램_v18_생성.py  (레포 루트 기준)
산출: docs/diagrams/v18_1차전_프로세스.png
"""
import os
import math
from PIL import Image, ImageDraw, ImageFont

S = 2  # scale
FONTPATH = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
OUT = '/Users/yujin-an/dev/fees/docs/diagrams'
os.makedirs(OUT, exist_ok=True)

NAVY = (31, 58, 95); GREY = (96, 96, 102); WHITE = (255, 255, 255)
BLUE_F = (232, 238, 246); BLUE_O = (150, 170, 198)
GREEN_F = (223, 242, 231); GREEN_O = (96, 168, 130); GREEN_T = (28, 105, 74)
AMBER_F = (250, 239, 220); AMBER_O = (205, 160, 95); AMBER_T = (150, 95, 10)
GREY_F = (238, 239, 242); GREY_O = (180, 182, 190)
BAND = (245, 247, 250)


def F(sz, idx=2):
    return ImageFont.truetype(FONTPATH, sz * S, index=idx)


def FB(sz):
    return ImageFont.truetype(FONTPATH, sz * S, index=5)


def canvas(w, h, bg=WHITE):
    img = Image.new('RGB', (w * S, h * S), bg)
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
    if cur:
        lines.append(cur)
    return lines


def ctext(d, cx, y, text, font, fill):
    tw = d.textlength(text, font=font)
    d.text((cx * S - tw / 2, y * S), text, font=font, fill=fill)


def ltext(d, x, y, text, font, fill):
    d.text((x * S, y * S), text, font=font, fill=fill)


def rrect(d, x, y, w, h, fill, outline, width=2, radius=14):
    d.rounded_rectangle([x * S, y * S, (x + w) * S, (y + h) * S],
                        radius=radius * S, fill=fill, outline=outline, width=width * S)


def arrow(d, p1, p2, color=NAVY, w=4):
    P1 = (p1[0] * S, p1[1] * S); P2 = (p2[0] * S, p2[1] * S)
    d.line([P1, P2], fill=color, width=w * S)
    a = math.atan2(P2[1] - P1[1], P2[0] - P1[0]); sz = 12 * S
    d.polygon([P2,
               (P2[0] - sz * math.cos(a - 0.45), P2[1] - sz * math.sin(a - 0.45)),
               (P2[0] - sz * math.cos(a + 0.45), P2[1] - sz * math.sin(a + 0.45))],
              fill=color)


def badge(d, cx, cy, n, fill=NAVY):
    r = 15
    d.ellipse([(cx - r) * S, (cy - r) * S, (cx + r) * S, (cy + r) * S], fill=fill)
    f = FB(15)
    tw = d.textlength(n, font=f)
    d.text((cx * S - tw / 2, cy * S - 15 * S / 2 - 1 * S), n, font=f, fill=WHITE)


def chip(d, x, y, w, h, text, fill, outline, tcolor, bold=False):
    rrect(d, x, y, w, h, fill, outline, width=2, radius=h / 2)
    f = FB(12) if bold else F(12)
    tw = d.textlength(text, font=f)
    d.text((x * S + (w * S - tw) / 2, y * S + (h * S - 12 * S * 1.2) / 2),
           text, font=f, fill=tcolor)


def phase(d, x, y, w, h, num, name, timing, timing_c, lines,
          fill, outline, tcolor, bold_border=2):
    rrect(d, x, y, w, h, fill, outline, width=bold_border, radius=16)
    badge(d, x + 22, y + 24, num, fill=tcolor if tcolor != GREY else NAVY)
    ctext(d, x + w / 2 + 12, y + 15, name, FB(15), tcolor)
    # 타이밍 태그
    tf = F(11)
    tag = timing
    tw = d.textlength(tag, font=tf)
    tx = x + (w - (tw / S + 16)) / 2
    rrect(d, tx, y + 40, tw / S + 16, 20, WHITE, timing_c, width=2, radius=10)
    d.text((tx * S + 8 * S, (y + 40) * S + 3 * S), tag, font=tf, fill=timing_c)
    yy = y + 70
    bf = F(12)
    for ln in lines:
        for sub in wrap(d, ln, bf, (w - 26) * S):
            d.text(((x + 15) * S, yy * S), '·  ' + sub if sub == wrap(d, ln, bf, (w - 26) * S)[0] else '    ' + sub,
                   font=bf, fill=GREY)
            yy += 12 * 1.55
        yy += 3


def main():
    W, H = 1400, 752
    img, d = canvas(W, H)

    # ── 제목
    ctext(d, W / 2, 26, '새 수수료 정책의 여정: 등록에서 원장 조회까지', FB(22), NAVY)
    ctext(d, W / 2, 58,
          '1차전은 승인 때 물리 테이블로 한 번 확정하고, 2차전은 배치마다 계좌에 배정한다 — 규모(계좌 수)와 무관',
          F(13), GREY)

    # ── 5단계 프로세스
    n = 5
    bx0, gap, bw, bh, by = 48, 30, 232, 196, 100
    phases = [
        (bx0 + 0 * (bw + gap), '1', '등록', '초안 단계', GREY, BLUE_F, BLUE_O, NAVY,
         ['정책 초안 · 요율표 연결', '적용범위 · 기간 · 대상 편입방식']),
        (bx0 + 1 * (bw + gap), '2', '검증 · 승인', '심사 결재', GREY, BLUE_F, BLUE_O, NAVY,
         ['지배관계 · 역마진 심사', '자격기준 · 유효기간 확정']),
        (bx0 + 2 * (bw + gap), '3', '1차전: 사전 랭킹', '승인 때 1회', GREEN_T, GREEN_F, GREEN_O, GREEN_T,
         ['계좌 무관 스코프 키 경쟁', '순위값 물리 저장', '6축 조합별 후보 색인']),
        (bx0 + 3 * (bw + gap), '4', '2차전: 계좌 배정', '배치마다', GREY, BLUE_F, BLUE_O, NAVY,
         ['계좌×셀 키 조회 + 자격 게이트', '배정판 적재(우대분만)']),
        (bx0 + 4 * (bw + gap), '5', '원장 조회', '체결 시', GREY, GREY_F, GREY_O, NAVY,
         ['배정판 점조회(행 수 무관)', '미스 = 기본수수료 직접 적용']),
    ]
    for x, num, name, timing, tcol, fill, outline, ttext, lines in phases:
        border = 3 if num == '3' else 2
        phase(d, x, by, bw, bh, num, name, timing, tcol, lines, fill, outline, ttext, border)

    # 단계 사이 화살표
    for i in range(n - 1):
        x1 = bx0 + i * (bw + gap) + bw
        x2 = x1 + gap
        arrow(d, (x1 + 3, by + bh / 2), (x2 - 2, by + bh / 2), color=NAVY, w=4)

    # ── 스포트라이트: 1차전을 물리 테이블로
    sy, sh = 336, 392
    rrect(d, 48, sy, W - 96, sh, BAND, GREEN_O, width=2, radius=18)
    # 라벨 탭
    lab = '1차전을 물리 테이블로 — 승인 때 계산하고, 이후 경로는 읽기만'
    lf = FB(15)
    lw = d.textlength(lab, font=lf)
    d.rectangle([64 * S, (sy - 12) * S, (64 * S + lw + 24 * S), (sy + 12) * S], fill=GREEN_T)
    d.text((76 * S, (sy - 11) * S), lab, font=lf, fill=WHITE)

    # 1차전 단계(3번)에서 스포트라이트로 내려가는 연결선
    p3x = bx0 + 2 * (bw + gap) + bw / 2
    d.line([p3x * S, (by + bh) * S, p3x * S, (sy) * S], fill=GREEN_O, width=3 * S)

    # 카드 A: 4축 → 6축
    ax, ay, aw, ah = 76, sy + 34, 616, 212
    rrect(d, ax, ay, aw, ah, WHITE, GREEN_O, width=2, radius=14)
    ltext(d, ax + 20, ay + 16, '변화 ①  색인 키: 4축 → 6축 완전 키화', FB(15), GREEN_T)
    ltext(d, ax + 20, ay + 46,
          '수수료 승자를 가르는 계좌 무관 축을 남김없이 색인 키로 승격', F(12), GREY)

    # 기존 4축 chips
    ltext(d, ax + 20, ay + 78, '기존 4축', FB(12), NAVY)
    base = ['자산군', '조회구분', '거래소', '품목']
    cx = ax + 20
    for c in base:
        w = 78
        chip(d, cx, ay + 98, w, 30, c, BLUE_F, BLUE_O, NAVY)
        cx += w + 8

    # + 2축 (강조)
    plus_x = cx + 6
    ltext(d, plus_x, ay + 100, '+', FB(18), AMBER_T)
    cx = plus_x + 22
    for c in ['세션', '채널']:
        w = 76
        chip(d, cx, ay + 98, w, 30, '+ ' + c, AMBER_F, AMBER_O, AMBER_T, bold=True)
        cx += w + 8

    ltext(d, ax + 20, ay + 146,
          '왜 승격? 야간 세션·MTS 채널만 한정한 이벤트가 승자를 바꿀 수 있음.', F(12), GREY)
    ltext(d, ax + 20, ay + 168,
          '두 축을 키에 넣어야 2차전이 계좌 루프 스캔 없이 순수 키 조회 + 게이트로 끝남.', F(12), GREY)

    # 카드 B: 인메모리 → 물리 테이블
    bx, byy, bwid, bhg = ax + aw + 20, sy + 34, W - 96 - (ax - 48) - aw - 20 - 28, 212
    rrect(d, bx, byy, bwid, bhg, WHITE, GREEN_O, width=2, radius=14)
    ltext(d, bx + 20, byy + 16, '변화 ②  인메모리 배치 계산 → 물리 테이블', FB(15), GREEN_T)

    # before → after
    ltext(d, bx + 20, byy + 50, '기존', FB(12), GREY)
    rrect(d, bx + 20, byy + 70, bwid - 40, 42, GREY_F, GREY_O, width=2, radius=10)
    ltext(d, bx + 34, byy + 80, '배치 실행 중 후보·순위 인메모리 재계산', F(12), GREY)
    ltext(d, bx + 34, byy + 96, '(계좌×셀마다 다시 훑음)', F(11), GREY)

    arrow(d, (bx + bwid / 2, byy + 116), (bx + bwid / 2, byy + 132), color=GREEN_T, w=3)

    ltext(d, bx + 20, byy + 136, '현재 · 물리 테이블 2종', FB(12), GREEN_T)
    rrect(d, bx + 20, byy + 156, bwid - 40, 42, GREEN_F, GREEN_O, width=2, radius=10)
    ltext(d, bx + 34, byy + 165, '순위값 스탬프 · 6축 조합별 후보 색인', FB(12), GREEN_T)
    ltext(d, bx + 34, byy + 182, '(tie_order · specificity 포함)', F(11), GREEN_T)

    # ── 하단: 읽기만 하는 경로들 + 효과
    fy = ay + ah + 26
    rrect(d, 76, fy, W - 152, 108, WHITE, GREEN_O, width=2, radius=14)
    ltext(d, 96, fy + 16, '한 번 물리화하면 — 이후 모든 경로는 저장된 순위값을 읽기만 한다', FB(15), GREEN_T)
    readers = ['일배치 전체 재산출', '수시 증분', '화면 조회', '미스 경로(기본 해석)']
    cx = 96
    for r in readers:
        w = d.textlength(r, font=F(12)) / S + 28
        chip(d, cx, fy + 46, w, 30, r, BLUE_F, BLUE_O, NAVY)
        cx += w + 12
    ltext(d, 96, fy + 84,
          '효과: 우선순위 판단은 승인 시점 한 곳에만 존재 · 배치는 결과 정렬·적재로 수렴(2억 행 6분 실측 연장선)',
          F(12), GREY)

    path = f'{OUT}/v18_1차전_프로세스.png'
    img.save(path)
    print('저장:', path, img.size)


if __name__ == '__main__':
    main()
