package kr.fees.persistence;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import kr.fees.domain.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.*;

@Repository
public class ScheduleRepository {

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public ScheduleRepository(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public Map<String, FeeScheduleModel> findAllAsMap() {
        Map<String, List<FeeComponent>> bySchedule = new LinkedHashMap<>();
        jdbc.query("SELECT * FROM fee_component ORDER BY schedule_id, seq", rs -> {
            bySchedule.computeIfAbsent(rs.getString("schedule_id"), k -> new ArrayList<>())
                .add(mapComponent(rs));
        });
        Map<String, FeeScheduleModel> out = new LinkedHashMap<>();
        jdbc.query("SELECT schedule_id, schedule_name FROM fee_schedule", rs -> {
            String id = rs.getString("schedule_id");
            out.put(id, new FeeScheduleModel(id, rs.getString("schedule_name"),
                bySchedule.getOrDefault(id, List.of())));
        });
        return out;
    }

    public Optional<FeeScheduleModel> findById(String id) {
        return Optional.ofNullable(findAllAsMap().get(id));
    }

    public void insert(FeeScheduleModel s) {
        jdbc.update("INSERT INTO fee_schedule(schedule_id, schedule_name) VALUES (?,?)", s.id(), s.name());
        int seq = 0;
        for (FeeComponent c : s.components()) {
            jdbc.update("""
                INSERT INTO fee_component(schedule_id, seq, name, kind, payer, rate_type, rate_bp, flat_amount, bands, min_fee)
                VALUES (?,?,?,?,?,?,?,?,?::jsonb,?)""",
                s.id(), seq++, c.name(), c.kind().name(), c.payer().name(), c.rateType().name(),
                c.rateBp(), c.flatAmount(), bandsJson(c.bands()), c.minFee());
        }
    }

    private FeeComponent mapComponent(java.sql.ResultSet rs) throws java.sql.SQLException {
        return new FeeComponent(
            rs.getString("name"), Kind.valueOf(rs.getString("kind")), Payer.valueOf(rs.getString("payer")),
            RateType.valueOf(rs.getString("rate_type")),
            rs.getBigDecimal("rate_bp"), rs.getBigDecimal("flat_amount"),
            parseBands(rs.getString("bands")), rs.getBigDecimal("min_fee"));
    }

    private String bandsJson(List<RateBand> bands) {
        if (bands == null) return null;
        try {
            List<Map<String, Object>> raw = new ArrayList<>();
            for (RateBand b : bands) {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("from", b.from());
                m.put("to", b.to());
                m.put("rateBp", b.rateBp());
                m.put("flat", b.flat());
                raw.add(m);
            }
            return json.writeValueAsString(raw);
        } catch (Exception e) {
            throw new IllegalStateException("bands 직렬화 실패", e);
        }
    }

    private List<RateBand> parseBands(String s) {
        if (s == null) return null;
        try {
            List<Map<String, Object>> raw = json.readValue(s, new TypeReference<>() {});
            List<RateBand> bands = new ArrayList<>();
            for (Map<String, Object> m : raw) {
                bands.add(new RateBand(bd(m.get("from")), bd(m.get("to")), bd(m.get("rateBp")), bd(m.get("flat"))));
            }
            return bands;
        } catch (Exception e) {
            throw new IllegalStateException("bands 파싱 실패: " + s, e);
        }
    }

    private BigDecimal bd(Object o) {
        return o == null ? null : new BigDecimal(o.toString());
    }
}
