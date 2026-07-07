package kr.fees.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;

@Repository
public class HistoryRepository {

    private final JdbcTemplate jdbc;

    public HistoryRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 배정 변경 이력 적재. old/new 중 없는 쪽(신규/삭제)은 null. */
    public void insert(BindingRow keyRow, String oldScheduleId, String oldRuleId, String oldType,
                       String newScheduleId, String newRuleId, String newType,
                       String triggerSource, String reason) {
        jdbc.update("""
            INSERT INTO fee_binding_history(account_id, asset_class, exchange_code, lookup_key, session_code,
                product_code, channel_code, old_schedule_id, old_source_rule_id, old_source_type,
                new_schedule_id, new_source_rule_id, new_source_type, trigger_source, change_reason)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            keyRow.accountId(), keyRow.assetClass().name(), keyRow.exchangeCode(), keyRow.lookupKey().name(),
            keyRow.sessionCode(), keyRow.productCode(), keyRow.channelCode(),
            oldScheduleId, oldRuleId, oldType, newScheduleId, newRuleId, newType, triggerSource, reason);
    }

    public List<HistoryRow> findByAccount(String accountId) {
        return jdbc.query("""
            SELECT * FROM fee_binding_history WHERE account_id = ? ORDER BY changed_at DESC, history_id DESC""",
            this::map, accountId);
    }

    private HistoryRow map(ResultSet rs, int rowNum) throws SQLException {
        return new HistoryRow(
            rs.getLong("history_id"), rs.getString("account_id"), rs.getString("asset_class"),
            rs.getString("lookup_key"), rs.getString("product_code"),
            rs.getString("old_schedule_id"), rs.getString("old_source_rule_id"), rs.getString("old_source_type"),
            rs.getString("new_schedule_id"), rs.getString("new_source_rule_id"), rs.getString("new_source_type"),
            rs.getString("trigger_source"), rs.getString("change_reason"),
            rs.getObject("changed_at", java.time.OffsetDateTime.class));
    }

    public record HistoryRow(long historyId, String accountId, String assetClass, String lookupKey,
                             String productCode, String oldScheduleId, String oldRuleId, String oldType,
                             String newScheduleId, String newRuleId, String newType,
                             String triggerSource, String reason, java.time.OffsetDateTime changedAt) {}
}
