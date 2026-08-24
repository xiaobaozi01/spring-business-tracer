package com.acme.gateway.service;

import com.acme.gateway.client.CatalogRestClient;
import com.acme.gateway.client.CatalogWebClient;
import com.acme.gateway.domain.CheckoutRecord;
import com.acme.gateway.messaging.CheckoutPublisher;
import com.acme.gateway.repository.CheckoutRepository;
import org.springframework.stereotype.Service;

@Service
public class CheckoutService {
    private final CatalogRestClient restClient;
    private final CatalogWebClient webClient;
    private final CheckoutPublisher publisher;
    private final CheckoutRepository repository;
    public CheckoutService(CatalogRestClient restClient, CatalogWebClient webClient, CheckoutPublisher publisher, CheckoutRepository repository) {
        this.restClient = restClient; this.webClient = webClient; this.publisher = publisher; this.repository = repository;
    }
    public String process(String sku) {
        String catalog = restClient.fetch(sku);
        webClient.fetch(sku);
        repository.save(new CheckoutRecord(sku, "CREATED"));
        publisher.publish(sku);
        return catalog;
    }
}
