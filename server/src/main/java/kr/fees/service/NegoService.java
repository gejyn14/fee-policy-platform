package kr.fees.service;

import kr.fees.batch.BatchResult;
import kr.fees.batch.IncrementalBinder;
import kr.fees.domain.*;
import kr.fees.persistence.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

/**
 * 협의수수료 워크플로우 (기술설계서 v1.5 §9). 신청(자격 자동판정) → 승인 → 연장 대상 산출 → 일괄 연장.
 * 협의 = 표준 등급 룰(NEGOTIATED) 부여. 계좌별 요율 조정(rateAdjust)은 표준등급 모델 유지 위해 미지원.
 */
@Service
public class NegoService {

    private final RuleRepository rules;
    private final AccountRepository accounts;
    private final EnrollmentRepository enrollments;
    private final QualifyPolicyRepository qualifyPolicies;
    private final IncrementalBinder binder;

    public NegoService(RuleRepository rules, AccountRepository accounts, EnrollmentRepository enrollments,
                       QualifyPolicyRepository qualifyPolicies, IncrementalBinder binder) {
        this.rules = rules;
        this.accounts = accounts;
        this.enrollments = enrollments;
        this.qualifyPolicies = qualifyPolicies;
        this.binder = binder;
    }

    public record QualifyResult(String accountId, boolean met, QualifyType qualifyType, String note) {}
    public record RequestResult(String requestId, List<QualifyResult> perAccount) {}

    /** 협의 신청 — 계좌별 자격 자동판정 후 REQUESTED 부여를 request_id 로 묶어 생성. */
    @Transactional
    public RequestResult createRequests(List<String> accountIds, String ruleId, Map<String, String> exceptionReasons,
                                        String requestedBy) {
        RuleModel rule = rules.findById(ruleId).orElseThrow(() -> new IllegalArgumentException("협의룰 없음: " + ruleId));
        if (rule.type() != RuleType.NEGOTIATED) throw new IllegalArgumentException("협의룰이 아닙니다: " + ruleId);
        AssetClass ac = rule.scope().assetClass();
        String requestId = "REQ-" + ruleId + "-" + accountIds.hashCode();

        List<QualifyResult> results = new ArrayList<>();
        for (String accountId : accountIds) {
            AccountModel acct = accounts.findById(accountId).orElseThrow(
                () -> new IllegalArgumentException("계좌 없음: " + accountId));
            boolean met = qualifies(ac, acct);
            QualifyType type;
            String note;
            if (met) {
                type = QualifyType.MET;
                note = "자격 충족";
            } else {
                String reason = exceptionReasons == null ? null : exceptionReasons.get(accountId);
                if (reason == null || reason.isBlank()) {
                    throw new IllegalArgumentException("미충족 계좌는 영업예외 사유가 필요합니다: " + accountId);
                }
                type = QualifyType.EXCEPTION;
                note = "영업예외: " + reason;
            }
            enrollments.insertRequest(accountId, ruleId, type,
                type == QualifyType.EXCEPTION ? note : null, requestId, requestedBy);
            results.add(new QualifyResult(accountId, met, type, note));
        }
        return new RequestResult(requestId, results);
    }

    @Transactional
    public BatchResult approve(String requestId, LocalDate baseDate, String approvedBy) {
        enrollments.approveByRequestId(requestId, baseDate, baseDate.plusYears(1), approvedBy);
        return binder.onNegoApproved(requestId, baseDate);
    }

    @Transactional
    public void reject(String requestId) {
        enrollments.rejectByRequestId(requestId);
    }

    // ---- 연장 대상 산출 (negoExtension.ts 이식) ----

    public enum ExtStatus { KEEP, DROP }
    public record ExtCandidate(long enrollmentId, String accountId, String accountName, ExtStatus status, String detail) {}
    public record ExtGroup(String axis, String groupKey, LocalDate validTo, List<ExtCandidate> candidates) {}

    public List<ExtGroup> extensionCandidates() {
        Map<String, ExtGroup> groups = new LinkedHashMap<>();
        Map<String, List<ExtCandidate>> byKey = new LinkedHashMap<>();
        Map<String, LocalDate> keyValidTo = new LinkedHashMap<>();
        Map<String, String[]> keyMeta = new LinkedHashMap<>();

        for (Enrollment e : activeNegoEnrollments()) {
            RuleModel rule = rules.findById(e.ruleId()).orElse(null);
            if (rule == null) continue;
            AccountModel acct = accounts.findById(e.accountId()).orElse(null);
            if (acct == null) continue;
            AssetClass ac = rule.scope().assetClass();
            boolean deriv = ac.isDerivative();
            String axis = deriv ? "품목" : "상품군";
            String groupKey = deriv
                ? (rule.scope().products() == null ? ac + " 전체 품목" : String.join(",", rule.scope().products()))
                : ac.name();
            String mapKey = axis + ":" + groupKey;

            boolean met = e.qualifyType() == QualifyType.EXCEPTION || qualifies(ac, acct);
            ExtStatus status = met ? ExtStatus.KEEP : ExtStatus.DROP;
            String detail = e.qualifyType() == QualifyType.EXCEPTION ? "영업예외(수동 검토)"
                : (met ? "자격 충족" : "자격 미충족 → 해지 대상");

            byKey.computeIfAbsent(mapKey, k -> new ArrayList<>())
                .add(new ExtCandidate(e.id(), e.accountId(), acct.name(), status, detail));
            keyValidTo.putIfAbsent(mapKey, e.validTo());
            keyMeta.putIfAbsent(mapKey, new String[]{axis, groupKey});
        }
        for (var entry : byKey.entrySet()) {
            String[] meta = keyMeta.get(entry.getKey());
            groups.put(entry.getKey(), new ExtGroup(meta[0], meta[1], keyValidTo.get(entry.getKey()), entry.getValue()));
        }
        return new ArrayList<>(groups.values());
    }

    @Transactional
    public BatchResult extend(List<Long> enrollmentIds, int months, LocalDate baseDate) {
        List<Enrollment> all = enrollments.findAll();
        Set<String> affected = new LinkedHashSet<>();
        for (long id : enrollmentIds) {
            Enrollment e = all.stream().filter(x -> x.id() == id).findFirst().orElse(null);
            if (e == null || e.validTo() == null) continue;
            enrollments.extend(id, e.validTo().plusMonths(months));
            affected.add(e.accountId());
        }
        return binder.onNegoExtended(affected, baseDate);
    }

    private List<Enrollment> activeNegoEnrollments() {
        Set<String> negoRuleIds = new HashSet<>();
        for (RuleModel r : rules.findAll()) if (r.type() == RuleType.NEGOTIATED) negoRuleIds.add(r.id());
        return enrollments.findAll().stream()
            .filter(e -> e.status() == EnrollmentStatus.ACTIVE && negoRuleIds.contains(e.ruleId()))
            .toList();
    }

    private boolean qualifies(AssetClass ac, AccountModel acct) {
        var policy = qualifyPolicies.findByAssetClass(ac);
        if (policy.isEmpty()) return true;
        BigDecimal value = policy.get().metric() == ConditionMetric.AVG_ASSET_6M
            ? acct.metric6mAsset() : acct.metric6mVolume();
        return value.compareTo(policy.get().threshold()) >= 0;
    }
}
