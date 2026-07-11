package kr.fees.batch;

import kr.fees.domain.*;
import kr.fees.persistence.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;

/**
 * 배정판 전체 재산출 (기술설계서 v1.5 §10.1). 정합성 진본.
 * 활성 룰로 랭킹을 구성하고, 계좌를 account_id 정렬 순서로 순회하며 배정판을 재유도한다.
 */
@Service
public class BindingRebuilder {

    private final RuleRepository rules;
    private final RankingRepository rankings;
    private final AccountRepository accounts;
    private final ProductRepository products;
    private final EnrollmentRepository enrollments;
    private final BindingWriter writer;
    private final BatchRunRepository batchRuns;

    public BindingRebuilder(RuleRepository rules, RankingRepository rankings, AccountRepository accounts,
                            ProductRepository products, EnrollmentRepository enrollments,
                            BindingWriter writer, BatchRunRepository batchRuns) {
        this.rules = rules;
        this.rankings = rankings;
        this.accounts = accounts;
        this.products = products;
        this.enrollments = enrollments;
        this.writer = writer;
        this.batchRuns = batchRuns;
    }

    @Transactional
    public BatchResult fullRebuild(LocalDate baseDate) {
        OffsetDateTime start = OffsetDateTime.now(ZoneOffset.UTC);
        List<RuleModel> active = rules.findActive(baseDate);
        List<RankedPolicy> ranking = rankings.ranking(active, baseDate);
        CandidateMap candidates = CandidateMap.build(
            CellUniverse.universe(products.findAll(), active), ranking);

        BatchResult total = BatchResult.zero();
        for (AccountModel acct : accounts.findAll()) {  // findAll 은 account_id 정렬
            var opened = accounts.openedGroups(acct.id());
            var enr = enrollments.findByAccount(acct.id());
            total = total.plus(writer.rebuildAccount(acct, enr, opened, candidates, baseDate, "DAILY_REBUILD"));
        }

        OffsetDateTime finish = OffsetDateTime.now(ZoneOffset.UTC);
        batchRuns.insert("FULL_REBUILD", baseDate, total.inserted(), total.updated(), total.deleted(),
            total.unchanged(), start, finish);
        return total;
    }
}
