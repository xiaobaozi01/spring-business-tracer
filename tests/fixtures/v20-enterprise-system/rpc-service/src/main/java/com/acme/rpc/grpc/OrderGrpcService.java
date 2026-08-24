package com.acme.rpc.grpc;
import com.acme.rpc.service.RpcOrderService;
import io.grpc.stub.StreamObserver;
import org.springframework.stereotype.Component;
@Component
public class OrderGrpcService extends OrderQueryGrpcBase {
    private final RpcOrderService service;
    public OrderGrpcService(RpcOrderService service) { this.service = service; }
    @Override public void find(FindRequest request, StreamObserver<FindReply> observer) {
        observer.onNext(new FindReply(service.find(request.getId())));
        observer.onCompleted();
    }
}
