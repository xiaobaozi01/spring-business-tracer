package com.acme.order.service;

public interface OrderService {
    Long create(String bizNo, Long customerId);
}
