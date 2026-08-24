package com.acme.catalog.job;

import com.acme.catalog.service.CatalogService;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("warmup")
public class CatalogWarmupRunner implements ApplicationRunner {
    private final CatalogService service;
    public CatalogWarmupRunner(CatalogService service) { this.service = service; }
    @Override public void run(ApplicationArguments args) { service.refresh(); }
}
