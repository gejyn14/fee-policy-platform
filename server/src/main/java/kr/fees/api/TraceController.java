package kr.fees.api;

import kr.fees.domain.AssetClass;
import kr.fees.domain.LookupKey;
import kr.fees.service.TraceService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;

/** 수수료 결정 추적 API — FeeTrace 화면용. */
@RestController
public class TraceController {

    private final TraceService trace;

    public TraceController(TraceService trace) {
        this.trace = trace;
    }

    @GetMapping("/api/trace")
    public TraceService.TraceResult trace(
        @RequestParam String accountId,
        @RequestParam AssetClass assetClass,
        @RequestParam LookupKey lookupKey,
        @RequestParam(defaultValue = "*") String exchange,
        @RequestParam(defaultValue = "*") String session,
        @RequestParam(defaultValue = "*") String product,
        @RequestParam(defaultValue = "*") String channel,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate tradeDate) {
        return trace.trace(accountId, assetClass, lookupKey, exchange, session, product, channel,
            tradeDate != null ? tradeDate : LocalDate.now());
    }
}
