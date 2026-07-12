# -*- coding: utf-8 -*-
"""기술설계서 v2.0 §5.2용 도식 — 1차전 경쟁 상대 선정과 전개 대비 효율.

policy-ranking-anatomy.html의 논지를 정적 도식으로 옮긴다.
  ① 전개(모든 경우의 수) vs 색인(정책이 부른 값만) 비교 — 빈 칸 폭발 대 실제 칸
  ② isCandidate로 조합마다 경쟁 명단을 고르는 절차(걸리는 조합만 갱신)
  ③ 효율 요약: 색인 크기 ∝ 정책의 잘기(계좌·경우의 수 무관), 조회 O(1)
실행: python3 docs/scripts/다이어그램_v20_생성.py → docs/diagrams/v20_후보선정_효율.png
"""
import os
import math
from PIL import Image, ImageDraw, ImageFont

S = 2
FONTPATH = '/System/Library/Fonts/AppleSDGothicNeo.ttc'
OUT = '/Users/yujin-an/dev/fees/docs/diagrams'
os.makedirs(OUT, exist_ok=True)

NAVY = (31, 58, 95); GREY = (96, 96, 102); WHITE = (255, 255, 255)
BLUE_F = (232, 238, 246); BLUE_O = (150, 170, 198)
GREEN_F = (223, 242, 231); GREEN_O = (96, 168, 130); GREEN_T = (28, 105, 74)
AMBER_F = (250, 239, 220); AMBER_O = (205, 160, 95); AMBER_T = (150, 95, 10)
GREY_F = (238, 239, 242); GREY_O = (180, 182, 190); EMPTY = (243, 244, 246)
BAND = (245, 247, 250)
RED_T = (176, 72, 60)


def F(sz):
    return ImageFont.truetype(FONTPATH, sz * S, index=2)


def FB(sz):
    return ImageFont.truetype(FONTPATH, sz * S, index=5)


def canvas(w, h, bg=WHITE):
    img = Image.new('RGB', (w * S, h * S), bg)
    return img, ImageDraw.Draw(img)


def ctext(d, cx, y, text, font, fill):
    d.text((cx * S - d.textlength(text, font=font) / 2, y * S), text, font=font, fill=fill)


def ltext(d, x, y, text, font, fill):
    d.text((x * S, y * S), text, font=font, fill=fill)


def rrect(d, x, y, w, h, fill, outline, width=2, radius=12):
    d.rounded_rectangle([x * S, y * S, (x + w) * S, (y + h) * S],
                        radius=radius * S, fill=fill, outline=outline, width=width * S)


def arrow(d, p1, p2, color=NAVY, w=4):
    P1 = (p1[0] * S, p1[1] * S); P2 = (p2[0] * S, p2[1] * S)
    d.line([P1, P2], fill=color, width=w * S)
    a = math.atan2(P2[1] - P1[1], P2[0] - P1[0]); sz = 11 * S
    d.polygon([P2, (P2[0] - sz * math.cos(a - 0.45), P2[1] - sz * math.sin(a - 0.45)),
               (P2[0] - sz * math.cos(a + 0.45), P2[1] - sz * math.sin(a + 0.45))], fill=color)


def chip(d, x, y, text, fill, outline, tcolor, bold=False, h=28):
    f = FB(12) if bold else F(12)
    w = d.textlength(text, font=f) / S + 24
    rrect(d, x, y, w, h, fill, outline, width=2, radius=h / 2)
    d.text((x * S + (w * S - d.textlength(text, font=f)) / 2, y * S + (h * S - 12 * S * 1.2) / 2),
           text, font=f, fill=tcolor)
    return x + w


def grid(d, x, y, cols, rows, cell, filled, fill_c, gap=3):
    """filled: set of (c,r) 칠할 칸. 나머지는 빈 칸."""
    for r in range(rows):
        for c in range(cols):
            cx = x + c * (cell + gap); cy = y + r * (cell + gap)
            on = (c, r) in filled
            d.rectangle([cx * S, cy * S, (cx + cell) * S, (cy + cell) * S],
                        fill=(fill_c if on else EMPTY),
                        outline=(GREEN_O if on else GREY_O), width=1 * S)


def main():
    W, H = 1420, 830
    img, d = canvas(W, H)

    ctext(d, W / 2, 24, "1차전 경쟁 상대 선정: 전개가 아니라 ‘정책이 부른 값’만", FB(22), NAVY)
    ctext(d, W / 2, 56,
          "축을 다 곱하지 않는다 — 정책이 한정한 값만 칸이 되고, 후보 없는 칸은 저장조차 하지 않는다",
          F(13), GREY)

    # ── Band 1: 전개 vs 색인
    by, bh = 96, 300
    # LEFT: 전개(안 씀)
    lx, lw = 48, 655
    rrect(d, lx, by, lw, bh, WHITE, GREY_O, width=2, radius=14)
    ltext(d, lx + 20, by + 16, "① 모든 경우의 수 전개", FB(16), GREY)
    chip(d, lx + lw - 92, by + 16, "안 씀", GREY_F, GREY_O, RED_T, bold=True, h=24)
    ltext(d, lx + 20, by + 52, "자산군×상품구분×거래소×품목×세션×채널×유동성×매수매도", F(12), GREY)
    ltext(d, lx + 20, by + 74, "축마다 값이 수십~수백 개 → 곱하면 조합이 폭발", F(12), GREY)
    fl = {(1, 0), (6, 1), (11, 2), (3, 3), (13, 0)}
    grid(d, lx + 20, by + 100, 15, 4, 34, fl, AMBER_O, gap=4)
    ltext(d, lx + 20, by + bh - 34, "대부분 빈 칸 — 어떤 정책도 겨냥하지 않는 헛조합", F(12), RED_T)

    # RIGHT: 색인(씀)
    rx, rw = lx + lw + 14, W - 48 - (lx + lw + 14)
    rrect(d, rx, by, rw, bh, GREEN_F, GREEN_O, width=3, radius=14)
    ltext(d, rx + 20, by + 16, "② 정책이 부른 값만 = 색인", FB(16), GREEN_T)
    chip(d, rx + rw - 78, by + 16, "채택", WHITE, GREEN_O, GREEN_T, bold=True, h=24)
    ltext(d, rx + 20, by + 52, "① 안 집은 값 → 전체(*) 한 칸으로 뭉침  (1차 거름)", F(12), GREEN_T)
    ltext(d, rx + 20, by + 74, "② 후보 0인 칸 → 아예 저장 안 함  (2차 거름)", F(12), GREEN_T)
    fr = {(0, 0), (1, 0), (0, 1), (2, 1), (1, 2)}
    grid(d, rx + 20, by + 108, 6, 3, 40, fr, GREEN_O, gap=6)
    ltext(d, rx + 320, by + 116, "실측 · 국내주식 9정책", FB(13), NAVY)
    ltext(d, rx + 320, by + 142, "8축 전부 곱 → 21칸", F(12), GREY)
    ltext(d, rx + 320, by + 164, "후보 있는 칸 12개", F(12), GREY)
    ltext(d, rx + 320, by + 186, "실린 행 30개 · 수백 KB", F(12), GREY)
    ltext(d, rx + 20, by + bh - 40, "실제로 요율이 갈리는 칸만 남아 계좌가 억이어도 수백 KB", F(12), GREEN_T)

    # ── Band 2: isCandidate 선정 흐름
    m_y, m_h = 420, 268
    rrect(d, 48, m_y, W - 96, m_h, BAND, BLUE_O, width=2, radius=16)
    lab = "경쟁 명단은 조합마다 isCandidate로 고른다 — ‘걸리는 조합만 갱신’"
    lw2 = d.textlength(lab, font=FB(15))
    d.rectangle([64 * S, (m_y - 12) * S, 64 * S + lw2 + 24 * S, (m_y + 12) * S], fill=NAVY)
    d.text((76 * S, (m_y - 11) * S), lab, font=FB(15), fill=WHITE)

    # 윗줄: NXT 한정 정책이 축을 늘리고 그 조합만 건드림
    y1 = m_y + 34
    b1 = 48 + 24
    rrect(d, b1, y1, 250, 66, WHITE, BLUE_O, 2, 12)
    ltext(d, b1 + 16, y1 + 12, "새 정책 승인", FB(13), NAVY)
    ltext(d, b1 + 16, y1 + 36, "대체거래소(NXT)만 한정", F(12), GREY)
    arrow(d, (b1 + 250, y1 + 33), (b1 + 300, y1 + 33))
    b2 = b1 + 300
    rrect(d, b2, y1, 300, 66, WHITE, BLUE_O, 2, 12)
    ltext(d, b2 + 16, y1 + 12, "거래소 축이 늘어남", FB(13), NAVY)
    ltext(d, b2 + 16, y1 + 36, "{전체, KRX} → {전체, KRX, NXT}", F(12), GREY)
    arrow(d, (b2 + 300, y1 + 33), (b2 + 350, y1 + 33))
    b3 = b2 + 350
    rrect(d, b3, y1, 320, 66, GREEN_F, GREEN_O, 2, 12)
    ltext(d, b3 + 16, y1 + 12, "NXT 조합만 재작성", FB(13), GREEN_T)
    ltext(d, b3 + 16, y1 + 36, "KRX·전체 조합은 손대지 않음", F(12), GREEN_T)

    # 아랫줄: 한 조합에서 명단 만들기
    y2 = y1 + 96
    ltext(d, b1, y2, "한 조합에서 명단 만들기:", FB(13), NAVY)
    y3 = y2 + 28
    s1 = b1
    rrect(d, s1, y3, 230, 56, WHITE, GREY_O, 2, 10)
    ltext(d, s1 + 14, y3 + 9, "그 조합의 활성 정책 전수", F(12), GREY)
    ltext(d, s1 + 14, y3 + 30, "(예: 9건 + 새 1건)", F(11), GREY)
    arrow(d, (s1 + 230, y3 + 28), (s1 + 278, y3 + 28))
    s2 = s1 + 278
    rrect(d, s2, y3, 250, 56, WHITE, BLUE_O, 2, 10)
    ltext(d, s2 + 14, y3 + 9, "isCandidate(범위, 조합)", FB(12), NAVY)
    ltext(d, s2 + 14, y3 + 30, "자산군·상품구분·거래소·품목… 매칭", F(11), GREY)
    arrow(d, (s2 + 250, y3 + 28), (s2 + 298, y3 + 28))
    s3 = s2 + 298
    rrect(d, s3, y3, 210, 56, WHITE, BLUE_O, 2, 10)
    ltext(d, s3 + 14, y3 + 9, "참가자만 → 순위값 ↑ 정렬", F(12), GREY)
    ltext(d, s3 + 14, y3 + 30, "(더 싼 쪽이 위)", F(11), GREY)
    arrow(d, (s3 + 210, y3 + 28), (s3 + 258, y3 + 28))
    s4 = s3 + 258
    rrect(d, s4, y3, 150, 56, GREEN_F, GREEN_O, 2, 10)
    ltext(d, s4 + 14, y3 + 9, "색인 행 묶음", FB(12), GREEN_T)
    ltext(d, s4 + 14, y3 + 30, "= 한 경쟁 그룹", F(11), GREEN_T)

    # ── Band 3: 효율 요약
    f_y = m_y + m_h + 20
    rrect(d, 48, f_y, W - 96, 96, WHITE, GREEN_O, width=2, radius=14)
    ltext(d, 68, f_y + 16, "왜 결정적으로 싼가", FB(15), GREEN_T)
    facts = [
        "색인 크기 ∝ 정책이 나눈 잘기 (계좌 수·경우의 수와 무관)",
        "조회: 8축 키 WHERE + 순위 LIMIT 1 → 억 행이어도 O(1) 한 줄",
        "저장 조금 더 ↔ 조회 O(1)을 사는 거래",
    ]
    cx = 68
    for t in facts:
        cx = chip(d, cx, f_y + 48, t, BLUE_F, BLUE_O, NAVY, h=30) + 12

    path = f'{OUT}/v20_후보선정_효율.png'
    img.save(path)
    print('저장:', path, img.size)


if __name__ == '__main__':
    main()
