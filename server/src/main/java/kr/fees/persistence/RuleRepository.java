package kr.fees.persistence;

import kr.fees.domain.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.Set;

@Repository
public class RuleRepository {

    private final JdbcTemplate jdbc;

    public RuleRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<RuleModel> findAll() {
        return jdbc.query("SELECT * FROM fee_rule ORDER BY rule_id", this::map);
    }

    public List<RuleModel> findActive(LocalDate today) {
        return jdbc.query("SELECT * FROM fee_rule WHERE rule_status = 'ACTIVE' ORDER BY rule_id", this::map);
    }

    public Optional<RuleModel> findById(String id) {
        List<RuleModel> rs = jdbc.query("SELECT * FROM fee_rule WHERE rule_id = ?", this::map, id);
        return rs.stream().findFirst();
    }

    public void insert(RuleModel r) {
        jdbc.update(con -> {
            var ps = con.prepareStatement("""
                INSERT INTO fee_rule(rule_id, rule_name, rule_type, rule_status, apply_mode, start_date, end_date,
                    benefit_kind, benefit_months, schedule_id, scope_asset_class, scope_exchanges, scope_sessions,
                    scope_lookup_keys, scope_products, scope_exclude_products, scope_channels,
                    condition_metric, condition_threshold, condition_action, target_account_ids, created_by)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""");
            int i = 1;
            ps.setString(i++, r.id());
            ps.setString(i++, r.name());
            ps.setString(i++, r.type().name());
            ps.setString(i++, r.status().name());
            ps.setString(i++, r.applyMode().name());
            ps.setObject(i++, r.startDate());
            ps.setObject(i++, r.endDate());
            ps.setString(i++, r.benefitKind().name());
            ps.setObject(i++, r.benefitMonths());
            ps.setString(i++, r.scheduleId());
            RuleScope s = r.scope();
            ps.setString(i++, s.assetClass().name());
            ps.setArray(i++, SqlArrays.toArray(con, s.exchanges()));
            ps.setArray(i++, SqlArrays.toArray(con, s.sessions()));
            ps.setArray(i++, s.lookupKeys() == null ? null
                : con.createArrayOf("text", s.lookupKeys().stream().map(Enum::name).toArray()));
            ps.setArray(i++, SqlArrays.toArray(con, s.products()));
            ps.setArray(i++, SqlArrays.toArray(con, s.excludeProducts()));
            ps.setArray(i++, SqlArrays.toArray(con, s.channels()));
            ps.setString(i++, r.condition() == null ? null : r.condition().metric().name());
            ps.setObject(i++, r.condition() == null ? null : r.condition().threshold());
            ps.setString(i++, r.condition() == null ? null : r.condition().action().name());
            ps.setArray(i++, SqlArrays.toArray(con, r.targetAccountIds()));
            ps.setString(i, "system");
            return ps;
        });
    }

    public void updateStatus(String ruleId, RuleStatus status) {
        jdbc.update("UPDATE fee_rule SET rule_status = ? WHERE rule_id = ?", status.name(), ruleId);
    }

    /** 신규 룰 ID 자동 채번. */
    public String nextRuleId() {
        Long n = jdbc.queryForObject("SELECT nextval('rule_id_seq')", Long.class);
        return "R-" + n;
    }

    private RuleModel map(ResultSet rs, int rowNum) throws SQLException {
        RuleScope scope = new RuleScope(
            AssetClass.valueOf(rs.getString("scope_asset_class")),
            SqlArrays.readSet(rs, "scope_exchanges"),
            SqlArrays.readSet(rs, "scope_sessions"),
            SqlArrays.readEnumSet(rs, "scope_lookup_keys", LookupKey::valueOf),
            SqlArrays.readSet(rs, "scope_products"),
            new java.util.LinkedHashSet<>(SqlArrays.readList(rs, "scope_exclude_products")),
            SqlArrays.readSet(rs, "scope_channels"));

        ConditionSpec condition = null;
        String metric = rs.getString("condition_metric");
        if (metric != null) {
            condition = new ConditionSpec(ConditionMetric.valueOf(metric),
                rs.getBigDecimal("condition_threshold"),
                ConditionSpec.ConditionAction.valueOf(rs.getString("condition_action")));
        }

        Integer benefitMonths = (Integer) rs.getObject("benefit_months");
        Set<String> targets = SqlArrays.readSet(rs, "target_account_ids");

        return new RuleModel(
            rs.getString("rule_id"), rs.getString("rule_name"),
            RuleType.valueOf(rs.getString("rule_type")), RuleStatus.valueOf(rs.getString("rule_status")),
            ApplyMode.valueOf(rs.getString("apply_mode")),
            rs.getObject("start_date", LocalDate.class), rs.getObject("end_date", LocalDate.class),
            BenefitKind.valueOf(rs.getString("benefit_kind")), benefitMonths,
            rs.getString("schedule_id"), scope, condition, targets);
    }
}
