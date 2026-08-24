package com.acme.ingress.service;

import com.acme.ingress.repository.OrderRepository;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    private final OrderRepository repository;
    public OrderService(OrderRepository repository) { this.repository = repository; }
    public String findForRoute(String id) { return repository.findById(id); }
    public String findForGraphql(String id) { return repository.findById(id); }
}
