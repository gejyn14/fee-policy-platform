// 'YYYY-MM-DD' + n개월. 결정적(Date.now/인자 없는 new Date 미사용). 월말 클램프.
export function addMonths(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;      // 0-based month index 누계
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;          // 1..12
  const lastDay = new Date(ny, nm, 0).getDate();   // 인자 있는 new Date — 월말 클램프에만
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}
