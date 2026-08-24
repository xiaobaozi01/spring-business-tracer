package com.acme.notification.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class NotificationRepository {
    private final JdbcTemplate jdbc;
    public NotificationRepository(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    public void insert(String sku, String channel) {
        jdbc.update("insert into notification.delivery_log(sku, channel) values (?, ?)", sku, channel);
    }
    public int dynamicCount(String table) {
        return jdbc.queryForObject("select count(*) from " + table, Integer.class);
    }
}
