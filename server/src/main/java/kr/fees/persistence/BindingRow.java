package kr.fees.persistence;

import kr.fees.domain.AssetClass;
import kr.fees.domain.LookupKey;
import kr.fees.domain.RuleType;

import java.time.LocalDate;

/** 배정판 한 행 (fee_binding 1:1). 우대(EVENT/NEGOTIATED)만 저장 — 기본은 미저장(§1.4). */
public record BindingRow(
    String accountId,
    AssetClass assetClass,
    String exchangeCode,
    LookupKey lookupKey,
    String sessionCode,
    String productCode,
    String channelCode,
    LocalDate validFrom,
    LocalDate validTo,
    String scheduleId,
    String sourceRuleId,
    RuleType sourceType,
    String reason
) {
    /** diff·이력 대조용 키(값 제외). */
    public String key() {
        return String.join("|", accountId, assetClass.name(), exchangeCode, lookupKey.name(),
            sessionCode, productCode, channelCode, validFrom.toString());
    }
}
