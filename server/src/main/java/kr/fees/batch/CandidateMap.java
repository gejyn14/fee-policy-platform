package kr.fees.batch;

import kr.fees.domain.FeeKey;
import kr.fees.domain.RankedPolicy;
import kr.fees.domain.ScopeMatcher;

import java.util.*;

/**
 * 셀(6축 FeeKey) → 순위순 후보 목록. 배치 실행당 1회, 계좌 무관으로 빌드한다.
 * 색인 적재(RankIndexService)와 계좌 산출(BindingWriter)이 같은 빌더를 공유한다 — 로직 한 벌.
 * 후보 판정은 ScopeMatcher.matches 그 자체다(6축 셀 키가 곧 FeeKey이므로).
 * 전제: ranking 은 이미 PolicyRanking.comparator() 정렬 상태다(fromStored·RankIndexService 공통).
 */
public final class CandidateMap {

    private final Map<FeeKey, List<RankedPolicy>> byCell;

    private CandidateMap(Map<FeeKey, List<RankedPolicy>> byCell) {
        this.byCell = byCell;
    }

    public static CandidateMap build(List<FeeKey> universe, List<RankedPolicy> ranking) {
        Map<FeeKey, List<RankedPolicy>> m = new LinkedHashMap<>();
        for (FeeKey cell : universe) {
            List<RankedPolicy> cands = new ArrayList<>();
            for (RankedPolicy p : ranking) {
                if (ScopeMatcher.matches(p.rule().scope(), cell)) cands.add(p);
            }
            m.put(cell, cands);
        }
        return new CandidateMap(m);
    }

    public Set<FeeKey> cells() {
        return byCell.keySet();
    }

    public List<RankedPolicy> candidates(FeeKey cell) {
        return byCell.getOrDefault(cell, List.of());
    }
}
