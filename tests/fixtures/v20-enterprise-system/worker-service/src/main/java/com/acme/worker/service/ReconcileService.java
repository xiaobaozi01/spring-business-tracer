package com.acme.worker.service;
import com.acme.worker.repository.ReconcileRepository;
import org.springframework.stereotype.Service;
@Service
public class ReconcileService {
    private final ReconcileRepository repository;
    public ReconcileService(ReconcileRepository repository) { this.repository = repository; }
    public void run() { repository.update(); }
}
