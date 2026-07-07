package kr.fees.api;

import kr.fees.domain.RuleModel;
import kr.fees.domain.RuleStatus;
import kr.fees.domain.RuleType;
import kr.fees.persistence.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/** 대시보드 집계. */
@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final RuleRepository rules;
    private final BindingRepository bindings;
    private final JdbcTemplate jdbc;

    public DashboardController(RuleRepository rules, BindingRepository bindings, JdbcTemplate jdbc) {
        this.rules = rules;
        this.bindings = bindings;
        this.jdbc = jdbc;
    }

    public record Dashboard(long activeRules, long pendingRules, long activeNego, long bindingRows,
                            List<RecentChange> recentChanges) {}

    public record RecentChange(String accountId, String assetClass, String lookupKey,
                               String newSourceType, String triggerSource, String changedAt) {}

    @GetMapping
    public Dashboard dashboard() {
        List<RuleModel> all = rules.findAll();
        long active = all.stream().filter(r -> r.status() == RuleStatus.ACTIVE).count();
        long pending = all.stream().filter(r -> r.status() == RuleStatus.PENDING).count();
        Long activeNego = jdbc.queryForObject(
            "SELECT count(*) FROM fee_enrollment e JOIN fee_rule r ON e.rule_id = r.rule_id " +
            "WHERE r.rule_type = 'NEGOTIATED' AND e.status = 'ACTIVE'", Long.class);

        List<RecentChange> recent = jdbc.query("""
            SELECT account_id, asset_class, lookup_key, new_source_type, trigger_source, changed_at
            FROM fee_binding_history ORDER BY changed_at DESC, history_id DESC LIMIT 10""",
            (rs, n) -> new RecentChange(rs.getString("account_id"), rs.getString("asset_class"),
                rs.getString("lookup_key"), rs.getString("new_source_type"), rs.getString("trigger_source"),
                String.valueOf(rs.getObject("changed_at"))));

        return new Dashboard(active, pending, activeNego == null ? 0 : activeNego, bindings.countAll(), recent);
    }
}
