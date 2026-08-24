package com.acme.worker.repository;
import org.springframework.stereotype.Repository;
@Repository
public class BillingRepository {
    public void insert(String id) { if (id == null) throw new IllegalArgumentException("id"); }
}
