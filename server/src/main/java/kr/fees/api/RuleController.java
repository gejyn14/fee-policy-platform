package kr.fees.api;

import kr.fees.batch.BatchResult;
import kr.fees.domain.FeeScheduleModel;
import kr.fees.domain.RuleModel;
import kr.fees.service.RuleService;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;

/** 룰 워크플로우 API. */
@RestController
@RequestMapping("/api/rules")
public class RuleController {

    private final RuleService ruleService;

    public RuleController(RuleService ruleService) {
        this.ruleService = ruleService;
    }

    public record CreateRuleRequest(RuleModel rule, FeeScheduleModel schedule) {}

    @PostMapping
    public RuleService.CreatedRule create(@RequestBody CreateRuleRequest req) {
        return ruleService.createDraft(req.rule(), req.schedule());
    }

    @PostMapping("/{ruleId}/validate")
    public RuleService.ValidationReport validate(@PathVariable String ruleId) {
        return ruleService.validate(ruleId);
    }

    @PostMapping("/{ruleId}/submit")
    public void submit(@PathVariable String ruleId) {
        ruleService.submit(ruleId);
    }

    @PostMapping("/{ruleId}/approve")
    public BatchResult approve(@PathVariable String ruleId,
                               @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate baseDate) {
        try {
            return ruleService.approve(ruleId, baseDate != null ? baseDate : LocalDate.now());
        } catch (RuleService.DominanceViolation e) {
            throw ApiException.badRequest(e.getMessage(), e.report());
        }
    }

    @PostMapping("/{ruleId}/reject")
    public void reject(@PathVariable String ruleId) {
        ruleService.reject(ruleId);
    }

    @PostMapping("/{ruleId}/expire")
    public BatchResult expire(@PathVariable String ruleId,
                              @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate baseDate) {
        return ruleService.expire(ruleId, baseDate != null ? baseDate : LocalDate.now());
    }
}
