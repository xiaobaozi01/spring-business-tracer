package com.acme.worker.service;
import com.acme.worker.repository.BillingRepository;
import org.springframework.stereotype.Service;
@Service
public class BillingService {
    private final BillingRepository repository;
    public BillingService(BillingRepository repository) { this.repository = repository; }
    public void process(String id) { repository.insert(id); }
}
