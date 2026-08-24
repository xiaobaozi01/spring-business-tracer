package com.acme.inventory.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class InventoryRepository {
    private final JdbcTemplate jdbcTemplate;

    public InventoryRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public int findAvailable(String sku) {
        return jdbcTemplate.queryForObject(
                "SELECT available FROM inventory.stock_item WHERE sku = ?",
                Integer.class,
                sku);
    }

    public void decreaseAvailable(String sku, int quantity) {
        jdbcTemplate.update(
                "UPDATE inventory.stock_item SET available = available - ? WHERE sku = ?",
                quantity,
                sku);
    }
}
