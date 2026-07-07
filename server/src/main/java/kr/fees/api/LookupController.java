package kr.fees.api;

import kr.fees.domain.*;
import kr.fees.service.LedgerLookupService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

/** 원장 체결 조회·요율 명세 (기술설계서 v1.5 §6). */
@RestController
@RequestMapping("/api")
public class LookupController {

    private final LedgerLookupService ledger;

    public LookupController(LedgerLookupService ledger) {
        this.ledger = ledger;
    }

    public record LookupResponse(String scheduleId, String sourceRuleId, RuleType sourceType, boolean fallbackToBase) {}

    @GetMapping("/lookup")
    public LookupResponse lookup(
        @RequestParam String accountId,
        @RequestParam AssetClass assetClass,
        @RequestParam LookupKey lookupKey,
        @RequestParam(defaultValue = "*") String exchange,
        @RequestParam(defaultValue = "*") String session,
        @RequestParam(defaultValue = "*") String product,
        @RequestParam(defaultValue = "*") String channel,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate tradeDate) {
        LocalDate d = tradeDate != null ? tradeDate : LocalDate.now();
        return ledger.lookup(accountId, assetClass, lookupKey, exchange, session, product, channel, d)
            .map(o -> new LookupResponse(o.scheduleId(), o.sourceRuleId(), o.sourceType(), o.fallbackToBase()))
            .orElseThrow(() -> ApiException.notFound("적용 가능한 요율표를 찾지 못했습니다(기본 룰 미정의)"));
    }

    public record CalcRequest(String scheduleId, BigDecimal price, long qty) {}

    public record CalcLine(String name, Kind kind, Payer payer, BigDecimal amount) {}

    public record CalcResponse(String scheduleId, String scheduleName, BigDecimal customerTotal,
                               BigDecimal companyBorne, List<CalcLine> lines) {}

    @PostMapping("/calc")
    public CalcResponse calc(@RequestBody CalcRequest req) {
        FeeScheduleModel s = ledger.schedule(req.scheduleId())
            .orElseThrow(() -> ApiException.notFound("요율표 없음: " + req.scheduleId()));
        FeeResult r = FeeCalculator.calc(s, new Execution(req.price(), req.qty()));
        List<CalcLine> lines = r.lines().stream()
            .map(l -> new CalcLine(l.name(), l.kind(), l.payer(), l.amount())).toList();
        return new CalcResponse(s.id(), s.name(), r.customerTotal(), r.companyBorne(), lines);
    }
}
