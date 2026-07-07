package kr.fees.api;

import kr.fees.batch.BatchResult;
import kr.fees.service.NegoService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/** 협의수수료 워크플로우 API. */
@RestController
@RequestMapping("/api/nego")
public class NegoController {

    private final NegoService nego;

    public NegoController(NegoService nego) {
        this.nego = nego;
    }

    public record CreateRequest(List<String> accountIds, String ruleId,
                                Map<String, String> exceptionReasons, String requestedBy) {}

    @PostMapping("/requests")
    public NegoService.RequestResult createRequests(@RequestBody CreateRequest req) {
        try {
            return nego.createRequests(req.accountIds(), req.ruleId(), req.exceptionReasons(),
                req.requestedBy() == null ? "system" : req.requestedBy());
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest(e.getMessage(), null);
        }
    }

    @PostMapping("/requests/{requestId}/approve")
    public BatchResult approve(@PathVariable String requestId,
                               @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate baseDate,
                               @RequestParam(required = false) String approvedBy) {
        return nego.approve(requestId, baseDate != null ? baseDate : LocalDate.now(),
            approvedBy == null ? "system" : approvedBy);
    }

    @PostMapping("/requests/{requestId}/reject")
    public void reject(@PathVariable String requestId) {
        nego.reject(requestId);
    }

    @GetMapping("/extension-candidates")
    public List<NegoService.ExtGroup> extensionCandidates() {
        return nego.extensionCandidates();
    }

    public record ExtendRequest(List<Long> enrollmentIds, Integer months) {}

    @PostMapping("/extend")
    public BatchResult extend(@RequestBody ExtendRequest req,
                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate baseDate) {
        int months = req.months() == null ? 12 : req.months();
        return nego.extend(req.enrollmentIds(), months, baseDate != null ? baseDate : LocalDate.now());
    }
}
