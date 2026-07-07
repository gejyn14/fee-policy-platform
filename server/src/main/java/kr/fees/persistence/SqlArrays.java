package kr.fees.persistence;

import java.sql.Array;
import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/** Postgres text[] ↔ Java Collection 변환 헬퍼. NULL 배열 = 전체(제약 없음). */
final class SqlArrays {

    private SqlArrays() {}

    static Array toArray(Connection con, Collection<String> vals) throws SQLException {
        if (vals == null) return null;
        return con.createArrayOf("text", vals.toArray());
    }

    static Set<String> readSet(ResultSet rs, String col) throws SQLException {
        String[] arr = read(rs, col);
        return arr == null ? null : new LinkedHashSet<>(Arrays.asList(arr));
    }

    static List<String> readList(ResultSet rs, String col) throws SQLException {
        String[] arr = read(rs, col);
        return arr == null ? List.of() : Arrays.asList(arr);
    }

    static <E> Set<E> readEnumSet(ResultSet rs, String col, Function<String, E> parse) throws SQLException {
        String[] arr = read(rs, col);
        return arr == null ? null : Arrays.stream(arr).map(parse).collect(Collectors.toCollection(LinkedHashSet::new));
    }

    private static String[] read(ResultSet rs, String col) throws SQLException {
        Array a = rs.getArray(col);
        return a == null ? null : (String[]) a.getArray();
    }
}
