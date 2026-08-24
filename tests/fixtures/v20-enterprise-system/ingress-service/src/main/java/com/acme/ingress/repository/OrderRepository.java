package com.acme.ingress.repository;
import org.springframework.stereotype.Repository;
@Repository
public class OrderRepository {
    public String findById(String id) { return id; }
}
