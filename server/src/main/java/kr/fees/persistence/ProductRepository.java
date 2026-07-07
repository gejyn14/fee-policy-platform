package kr.fees.persistence;

import kr.fees.domain.AssetClass;
import kr.fees.domain.ProductModel;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

@Repository
public class ProductRepository {

    private final JdbcTemplate jdbc;

    public ProductRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public List<ProductModel> findAll() {
        return jdbc.query("SELECT * FROM product ORDER BY asset_class, exchange_code, product_code", this::map);
    }

    public List<ProductModel> findByAssetClass(AssetClass ac) {
        return jdbc.query("SELECT * FROM product WHERE asset_class = ? ORDER BY exchange_code, product_code",
            this::map, ac.name());
    }

    private ProductModel map(ResultSet rs, int rowNum) throws SQLException {
        return new ProductModel(
            AssetClass.valueOf(rs.getString("asset_class")), rs.getString("exchange_code"),
            rs.getString("product_code"), rs.getString("product_name"), rs.getString("currency"),
            SqlArrays.readList(rs, "sessions"));
    }
}
