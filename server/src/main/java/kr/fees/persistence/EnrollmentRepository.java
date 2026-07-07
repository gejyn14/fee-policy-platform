package kr.fees.persistence;

import kr.fees.domain.Enrollment;
import kr.fees.domain.EnrollmentStatus;
import kr.fees.domain.QualifyType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.LocalDate;
import java.util.List;

@Repository
public class EnrollmentRepository {

    private final JdbcTemplate jdbc;

    public EnrollmentRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<Enrollment> findByAccount(String accountId) {
        return jdbc.query("SELECT * FROM fee_enrollment WHERE account_id = ?", this::map, accountId);
    }

    public List<Enrollment> findAll() {
        return jdbc.query("SELECT * FROM fee_enrollment ORDER BY enrollment_id", this::map);
    }

    public List<Enrollment> findByRequestId(String requestId) {
        return jdbc.query("SELECT * FROM fee_enrollment WHERE request_id = ?", this::map, requestId);
    }

    public List<String> accountIdsByRuleId(String ruleId) {
        return jdbc.queryForList(
            "SELECT DISTINCT account_id FROM fee_enrollment WHERE rule_id = ?", String.class, ruleId);
    }

    /** 협의/이벤트 신청 요청 생성(REQUESTED). request_id 로 묶는다. */
    public long insertRequest(String accountId, String ruleId, QualifyType qualifyType, String reason,
                              String requestId, String requestedBy) {
        KeyHolder kh = new GeneratedKeyHolder();
        jdbc.update(con -> {
            var ps = con.prepareStatement("""
                INSERT INTO fee_enrollment(account_id, rule_id, status, qualify_type, reason, request_id,
                    requested_by, requested_at)
                VALUES (?,?, 'REQUESTED', ?,?,?,?, now())""", Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, accountId);
            ps.setString(2, ruleId);
            ps.setString(3, qualifyType == null ? null : qualifyType.name());
            ps.setString(4, reason);
            ps.setString(5, requestId);
            ps.setString(6, requestedBy);
            return ps;
        }, kh);
        return ((Number) kh.getKeys().get("enrollment_id")).longValue();
    }

    /** 이벤트 가입 등 즉시 ACTIVE 부여(신청형 이벤트). */
    public long insertActiveEvent(String accountId, String ruleId, LocalDate enrolledAt, String channel) {
        KeyHolder kh = new GeneratedKeyHolder();
        jdbc.update(con -> {
            var ps = con.prepareStatement("""
                INSERT INTO fee_enrollment(account_id, rule_id, status, enrolled_at, channel)
                VALUES (?,?, 'ACTIVE', ?, ?)""", Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, accountId);
            ps.setString(2, ruleId);
            ps.setObject(3, enrolledAt);
            ps.setString(4, channel);
            return ps;
        }, kh);
        return ((Number) kh.getKeys().get("enrollment_id")).longValue();
    }

    public void approveByRequestId(String requestId, LocalDate from, LocalDate to, String approvedBy) {
        jdbc.update("""
            UPDATE fee_enrollment SET status = 'ACTIVE', valid_from = ?, valid_to = ?,
                approved_by = ?, approved_at = now()
            WHERE request_id = ? AND status = 'REQUESTED'""", from, to, approvedBy, requestId);
    }

    public void rejectByRequestId(String requestId) {
        jdbc.update("UPDATE fee_enrollment SET status = 'REJECTED' WHERE request_id = ? AND status = 'REQUESTED'",
            requestId);
    }

    public void extend(long enrollmentId, LocalDate newValidTo) {
        jdbc.update("UPDATE fee_enrollment SET valid_to = ? WHERE enrollment_id = ?", newValidTo, enrollmentId);
    }

    private Enrollment map(ResultSet rs, int rowNum) throws SQLException {
        String qt = rs.getString("qualify_type");
        return new Enrollment(
            rs.getLong("enrollment_id"), rs.getString("account_id"), rs.getString("rule_id"),
            EnrollmentStatus.valueOf(rs.getString("status")),
            rs.getObject("valid_from", LocalDate.class), rs.getObject("valid_to", LocalDate.class),
            qt == null ? null : QualifyType.valueOf(qt),
            rs.getObject("enrolled_at", LocalDate.class));
    }
}
