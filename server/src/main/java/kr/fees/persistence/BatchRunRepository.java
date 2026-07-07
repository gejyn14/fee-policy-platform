package kr.fees.persistence;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

@Repository
public class BatchRunRepository {

    private final JdbcTemplate jdbc;

    public BatchRunRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public void insert(String runType, LocalDate baseDate, int inserted, int updated, int deleted, int unchanged,
                       OffsetDateTime startedAt, OffsetDateTime finishedAt) {
        jdbc.update("""
            INSERT INTO batch_run(run_type, base_date, inserted, updated, deleted, unchanged, started_at, finished_at)
            VALUES (?,?,?,?,?,?,?,?)""",
            runType, baseDate, inserted, updated, deleted, unchanged, startedAt, finishedAt);
    }

    public List<Run> findRecent() {
        return jdbc.query("SELECT * FROM batch_run ORDER BY run_id DESC LIMIT 20", this::map);
    }

    private Run map(ResultSet rs, int rowNum) throws SQLException {
        return new Run(rs.getLong("run_id"), rs.getString("run_type"),
            rs.getObject("base_date", LocalDate.class), rs.getInt("inserted"), rs.getInt("updated"),
            rs.getInt("deleted"), rs.getInt("unchanged"),
            rs.getObject("started_at", OffsetDateTime.class), rs.getObject("finished_at", OffsetDateTime.class));
    }

    public record Run(long runId, String runType, LocalDate baseDate, int inserted, int updated, int deleted,
                      int unchanged, OffsetDateTime startedAt, OffsetDateTime finishedAt) {}
}
