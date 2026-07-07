package kr.fees.batch;

import kr.fees.domain.*;
import kr.fees.persistence.BindingRepository;
import kr.fees.persistence.BindingRow;
import kr.fees.persistence.HistoryRepository;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.*;

/**
 * 배정판 승자 확정 + diff + 이력 — 전체 재산출·delta·수시 증분이 공유하는 단일 코어(로직 한 벌).
 * 기본(BASE) 승자는 행을 쓰지 않는다(§1.4: 배정판은 우대분만). 미스는 원장이 기본수수료로 처리.
 */
@Component
public class BindingWriter {

    private final BindingRepository bindings;
    private final HistoryRepository history;

    public BindingWriter(BindingRepository bindings, HistoryRepository history) {
        this.bindings = bindings;
        this.history = history;
    }

    /** 한 계좌의 배정판을 기대값과 대조해 반영한다. trigger = 이력 트리거 소스. */
    public BatchResult rebuildAccount(AccountModel acct, List<Enrollment> enr, Set<AssetClass> opened,
                                      List<ProductModel> products, List<RuleModel> activeRules,
                                      List<RankedPolicy> ranking, LocalDate baseDate, String trigger) {
        Map<String, BindingRow> expected = new LinkedHashMap<>();
        for (FeeKey cell : CellUniverse.cellsFor(acct.id(), opened, products, activeRules)) {
            Optional<Winner> w = WinnerResolver.winnerFor(cell, acct, enr, ranking, baseDate);
            if (w.isEmpty() || w.get().sourceType() == RuleType.BASE) continue;  // 기본은 미저장
            if (w.get().validFrom() == null) continue;
            BindingRow row = toRow(acct.id(), cell, w.get());
            expected.put(row.key(), row);
        }

        Map<String, BindingRow> current = new LinkedHashMap<>();
        for (BindingRow r : bindings.findByAccount(acct.id())) current.put(r.key(), r);

        int inserted = 0, updated = 0, deleted = 0, unchanged = 0;
        List<BindingRow> toInsert = new ArrayList<>();

        for (Map.Entry<String, BindingRow> e : expected.entrySet()) {
            BindingRow want = e.getValue();
            BindingRow have = current.get(e.getKey());
            if (have == null) {
                toInsert.add(want);
                history.insert(want, null, null, null, want.scheduleId(), want.sourceRuleId(),
                    want.sourceType().name(), trigger, want.reason());
                inserted++;
            } else if (differs(have, want)) {
                bindings.deleteByKey(have);
                toInsert.add(want);
                history.insert(want, have.scheduleId(), have.sourceRuleId(), have.sourceType().name(),
                    want.scheduleId(), want.sourceRuleId(), want.sourceType().name(), trigger, want.reason());
                updated++;
            } else {
                unchanged++;
            }
        }
        for (Map.Entry<String, BindingRow> e : current.entrySet()) {
            if (!expected.containsKey(e.getKey())) {
                BindingRow have = e.getValue();
                bindings.deleteByKey(have);
                history.insert(have, have.scheduleId(), have.sourceRuleId(), have.sourceType().name(),
                    null, null, null, trigger, "기본으로 복귀");
                deleted++;
            }
        }

        toInsert.sort(Comparator.comparing(BindingRow::key));
        if (!toInsert.isEmpty()) bindings.batchInsert(toInsert);
        return new BatchResult(inserted, updated, deleted, unchanged);
    }

    private boolean differs(BindingRow a, BindingRow b) {
        return !a.scheduleId().equals(b.scheduleId())
            || !a.sourceRuleId().equals(b.sourceRuleId())
            || a.sourceType() != b.sourceType()
            || !a.validTo().equals(b.validTo());
    }

    private BindingRow toRow(String accountId, FeeKey cell, Winner w) {
        String product = cell.product() == null ? "*" : cell.product();
        return new BindingRow(accountId, cell.assetClass(), cell.exchange(), cell.lookupKey(),
            cell.session(), product, cell.channel(), w.validFrom(), w.validTo(),
            w.scheduleId(), w.ruleId(), w.sourceType(), w.reason());
    }
}
