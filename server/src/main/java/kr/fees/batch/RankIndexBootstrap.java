package kr.fees.batch;

import kr.fees.persistence.CandidateIndexRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.time.LocalDate;

/**
 * 기동 시 순위 사전 산정 보정. 시드·reseed 는 룰을 ACTIVE 로 직접 삽입(승인 경로 우회)하므로
 * rank_value 누락 또는 색인 공백이 있으면 1회 재적재한다. 운영 중 수작업 정정 후에는
 * POST /api/batch/rank-index/rebuild 로 같은 보정을 수동 실행할 수 있다.
 */
@Component
public class RankIndexBootstrap implements ApplicationRunner {

    private static final Logger LOG = LoggerFactory.getLogger(RankIndexBootstrap.class);

    private final RankIndexService rankIndex;
    private final CandidateIndexRepository candidateIndex;
    private final JdbcTemplate jdbc;

    public RankIndexBootstrap(RankIndexService rankIndex, CandidateIndexRepository candidateIndex, JdbcTemplate jdbc) {
        this.rankIndex = rankIndex;
        this.candidateIndex = candidateIndex;
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        Integer missing = jdbc.queryForObject(
            "SELECT count(*) FROM fee_rule WHERE rule_status = 'ACTIVE' AND rank_value IS NULL", Integer.class);
        boolean needs = (missing != null && missing > 0) || candidateIndex.isEmpty();
        if (!needs) return;
        var summary = rankIndex.rebuildAll(LocalDate.now());
        LOG.info("기동 순위 보정: rank_value {}건, 조합 {}개, 색인 {}행",
            summary.rulesStamped(), summary.combos(), summary.indexRows());
    }
}
