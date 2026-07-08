package kr.fees.api;

import kr.fees.domain.AssetClass;
import kr.fees.domain.LookupKey;
import kr.fees.service.PriorityService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.List;

/** 정책 우선순위 API — PolicyPriority 화면용. */
@RestController
public class PriorityController {

    private final PriorityService priority;

    public PriorityController(PriorityService priority) {
        this.priority = priority;
    }

    @GetMapping("/api/priority")
    public List<PriorityService.Entry> ranking(
        @RequestParam(required = false) AssetClass assetClass,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate tradeDate) {
        return priority.ranking(assetClass, tradeDate != null ? tradeDate : LocalDate.now());
    }

    @GetMapping("/api/priority/top")
    public PriorityService.TopResponse top(
        @RequestParam AssetClass assetClass,
        @RequestParam LookupKey lookupKey,
        @RequestParam(defaultValue = "*") String exchange,
        @RequestParam(defaultValue = "*") String session,
        @RequestParam(defaultValue = "*") String product,
        @RequestParam(defaultValue = "*") String channel,
        @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate tradeDate) {
        return priority.top(assetClass, lookupKey, exchange, session, product, channel,
            tradeDate != null ? tradeDate : LocalDate.now());
    }
}
