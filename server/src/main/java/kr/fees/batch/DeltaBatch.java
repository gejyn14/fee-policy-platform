package kr.fees.batch;

import kr.fees.domain.RuleModel;
import kr.fees.persistence.AccountRepository;
import kr.fees.persistence.BatchRunRepository;
import kr.fees.persistence.BindingRepository;
import kr.fees.persistence.RuleRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * 일 delta 배치 (기술설계서 v1.5 §10.3 ②). 날짜 경과로 승자가 바뀔 수 있는 셀만 재산출:
 *   ① 전일 만료(valid_to = baseDate-1)한 우대 행의 계좌
 *   ② 당일 시작(start_date = baseDate)하는 룰의 scope 계좌
 * 전체 재산출의 극히 일부만 건드려 초 단위로 끝난다.
 */
@Service
public class DeltaBatch {

    private final BindingRepository bindings;
    private final RuleRepository rules;
    private final AccountRepository accounts;
    private final IncrementalBinder binder;
    private final BatchRunRepository batchRuns;

    public DeltaBatch(BindingRepository bindings, RuleRepository rules, AccountRepository accounts,
                      IncrementalBinder binder, BatchRunRepository batchRuns) {
        this.bindings = bindings;
        this.rules = rules;
        this.accounts = accounts;
        this.binder = binder;
        this.batchRuns = batchRuns;
    }

    @Transactional
    public BatchResult run(LocalDate baseDate) {
        OffsetDateTime start = OffsetDateTime.now(ZoneOffset.UTC);
        Set<String> affected = new LinkedHashSet<>(bindings.accountsWithValidTo(baseDate.minusDays(1)));
        for (RuleModel r : rules.findActive(baseDate)) {
            if (r.startDate().equals(baseDate)) {
                affected.addAll(accounts.accountIdsByOpenedGroup(r.scope().assetClass()));
            }
        }
        BatchResult result = binder.rebuildAccounts(affected, baseDate, "DELTA");

        OffsetDateTime finish = OffsetDateTime.now(ZoneOffset.UTC);
        batchRuns.insert("DELTA", baseDate, result.inserted(), result.updated(), result.deleted(),
            result.unchanged(), start, finish);
        return result;
    }
}
