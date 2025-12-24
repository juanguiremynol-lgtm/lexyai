import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Plus,
  FileText,
  CalendarIcon,
  Trash2,
  Check,
  DollarSign,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";

interface Contract {
  id: string;
  client_id: string;
  service_description: string;
  contract_value: number;
  payment_modality: string;
  contract_date: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface ContractPayment {
  id: string;
  contract_id: string;
  description: string;
  amount: number;
  due_date: string | null;
  paid_at: string | null;
  created_at: string;
}

interface ContractsTabProps {
  clientId: string;
  clientName: string;
}

const PAYMENT_MODALITIES = [
  { value: "MILESTONE", label: "Por Hitos" },
  { value: "MONTHLY", label: "Mensual" },
  { value: "ONE_TIME", label: "Pago Único" },
  { value: "HOURLY", label: "Por Hora" },
];

const CONTRACT_STATUSES = [
  { value: "ACTIVE", label: "Activo", color: "bg-green-100 text-green-700" },
  { value: "COMPLETED", label: "Completado", color: "bg-blue-100 text-blue-700" },
  { value: "CANCELLED", label: "Cancelado", color: "bg-red-100 text-red-700" },
  { value: "PAUSED", label: "Pausado", color: "bg-yellow-100 text-yellow-700" },
];

export function ContractsTab({ clientId, clientName }: ContractsTabProps) {
  const queryClient = useQueryClient();
  const [newContractOpen, setNewContractOpen] = useState(false);
  const [newPaymentOpen, setNewPaymentOpen] = useState<string | null>(null);
  const [deleteContractId, setDeleteContractId] = useState<string | null>(null);
  const [markPaidId, setMarkPaidId] = useState<string | null>(null);

  // Form state for new contract
  const [contractForm, setContractForm] = useState({
    serviceDescription: "",
    contractValue: "",
    paymentModality: "MILESTONE",
    contractDate: new Date(),
    notes: "",
  });

  // Form state for new payment
  const [paymentForm, setPaymentForm] = useState({
    description: "",
    amount: "",
    dueDate: undefined as Date | undefined,
  });

  // Fetch contracts
  const { data: contracts, isLoading: contractsLoading } = useQuery({
    queryKey: ["contracts", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contracts")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Contract[];
    },
  });

  // Fetch all payments for this client's contracts
  const { data: allPayments } = useQuery({
    queryKey: ["contract-payments", clientId],
    queryFn: async () => {
      if (!contracts?.length) return [];
      const contractIds = contracts.map((c) => c.id);
      const { data, error } = await supabase
        .from("contract_payments")
        .select("*")
        .in("contract_id", contractIds)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data as ContractPayment[];
    },
    enabled: !!contracts?.length,
  });

  // Create contract mutation
  const createContract = useMutation({
    mutationFn: async () => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No autenticado");

      const { error } = await supabase.from("contracts").insert({
        owner_id: user.user.id,
        client_id: clientId,
        service_description: contractForm.serviceDescription,
        contract_value: parseFloat(contractForm.contractValue) || 0,
        payment_modality: contractForm.paymentModality,
        contract_date: format(contractForm.contractDate, "yyyy-MM-dd"),
        notes: contractForm.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contracts", clientId] });
      setNewContractOpen(false);
      setContractForm({
        serviceDescription: "",
        contractValue: "",
        paymentModality: "MILESTONE",
        contractDate: new Date(),
        notes: "",
      });
      toast.success("Contrato creado");
    },
    onError: (error) => toast.error("Error: " + error.message),
  });

  // Create payment mutation
  const createPayment = useMutation({
    mutationFn: async (contractId: string) => {
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) throw new Error("No autenticado");

      const { error } = await supabase.from("contract_payments").insert({
        owner_id: user.user.id,
        contract_id: contractId,
        description: paymentForm.description,
        amount: parseFloat(paymentForm.amount) || 0,
        due_date: paymentForm.dueDate
          ? format(paymentForm.dueDate, "yyyy-MM-dd")
          : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contract-payments", clientId] });
      setNewPaymentOpen(null);
      setPaymentForm({ description: "", amount: "", dueDate: undefined });
      toast.success("Pago/Hito agregado");
    },
    onError: (error) => toast.error("Error: " + error.message),
  });

  // Mark payment as paid
  const markAsPaid = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase
        .from("contract_payments")
        .update({ paid_at: new Date().toISOString() })
        .eq("id", paymentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contract-payments", clientId] });
      setMarkPaidId(null);
      toast.success("Pago registrado");
    },
    onError: (error) => toast.error("Error: " + error.message),
  });

  // Delete contract
  const deleteContract = useMutation({
    mutationFn: async (contractId: string) => {
      const { error } = await supabase
        .from("contracts")
        .delete()
        .eq("id", contractId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contracts", clientId] });
      queryClient.invalidateQueries({ queryKey: ["contract-payments", clientId] });
      setDeleteContractId(null);
      toast.success("Contrato eliminado");
    },
    onError: (error) => toast.error("Error: " + error.message),
  });

  // Delete payment
  const deletePayment = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase
        .from("contract_payments")
        .delete()
        .eq("id", paymentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contract-payments", clientId] });
      toast.success("Pago eliminado");
    },
    onError: (error) => toast.error("Error: " + error.message),
  });

  // Calculate totals for a contract
  const getContractTotals = (contractId: string, contractValue: number) => {
    const payments = allPayments?.filter((p) => p.contract_id === contractId) || [];
    const totalPaid = payments
      .filter((p) => p.paid_at)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const totalPending = payments
      .filter((p) => !p.paid_at)
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const owed = contractValue - totalPaid;
    return { totalPaid, totalPending, owed, payments };
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      minimumFractionDigits: 0,
    }).format(value);
  };

  if (contractsLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium">Contratos</h3>
        <Button onClick={() => setNewContractOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Contrato
        </Button>
      </div>

      {!contracts?.length ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <FileText className="mx-auto h-10 w-10 mb-2 opacity-50" />
            <p>No hay contratos registrados para este cliente</p>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple" className="space-y-4">
          {contracts.map((contract) => {
            const { totalPaid, totalPending, owed, payments } = getContractTotals(
              contract.id,
              Number(contract.contract_value)
            );
            const statusConfig = CONTRACT_STATUSES.find(
              (s) => s.value === contract.status
            );

            return (
              <AccordionItem
                key={contract.id}
                value={contract.id}
                className="border rounded-lg px-4"
              >
                <AccordionTrigger className="hover:no-underline">
                  <div className="flex items-center justify-between w-full pr-4">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div className="text-left">
                        <p className="font-medium">{contract.service_description}</p>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(contract.contract_date), "dd/MM/yyyy", {
                            locale: es,
                          })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Badge className={cn("text-xs", statusConfig?.color)}>
                        {statusConfig?.label}
                      </Badge>
                      <div className="text-right">
                        <p className="font-medium">
                          {formatCurrency(Number(contract.contract_value))}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {PAYMENT_MODALITIES.find(
                            (m) => m.value === contract.payment_modality
                          )?.label}
                        </p>
                      </div>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-4">
                  {/* Summary Cards */}
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <Card className="bg-green-50 dark:bg-green-950/20 border-green-200">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                          <Check className="h-4 w-4" />
                          <span className="text-sm font-medium">Pagado</span>
                        </div>
                        <p className="text-xl font-bold mt-1 text-green-800 dark:text-green-300">
                          {formatCurrency(totalPaid)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="text-sm font-medium">Pendiente</span>
                        </div>
                        <p className="text-xl font-bold mt-1 text-amber-800 dark:text-amber-300">
                          {formatCurrency(totalPending)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="bg-blue-50 dark:bg-blue-950/20 border-blue-200">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                          <DollarSign className="h-4 w-4" />
                          <span className="text-sm font-medium">Por Cobrar</span>
                        </div>
                        <p className="text-xl font-bold mt-1 text-blue-800 dark:text-blue-300">
                          {formatCurrency(owed)}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Notes */}
                  {contract.notes && (
                    <p className="text-sm text-muted-foreground mb-4 p-3 bg-muted/50 rounded">
                      {contract.notes}
                    </p>
                  )}

                  {/* Payments/Hitos Table */}
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium">Pagos / Hitos</h4>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setNewPaymentOpen(contract.id)}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Agregar
                    </Button>
                  </div>

                  {payments.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No hay pagos registrados
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Descripción</TableHead>
                          <TableHead>Fecha Vencimiento</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead className="text-right">Acciones</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell>{payment.description}</TableCell>
                            <TableCell>
                              {payment.due_date
                                ? format(new Date(payment.due_date), "dd/MM/yyyy", {
                                    locale: es,
                                  })
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {formatCurrency(Number(payment.amount))}
                            </TableCell>
                            <TableCell>
                              {payment.paid_at ? (
                                <Badge className="bg-green-100 text-green-700">
                                  Pagado{" "}
                                  {format(new Date(payment.paid_at), "dd/MM/yy")}
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-amber-600">
                                  Pendiente
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                {!payment.paid_at && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-green-600"
                                    onClick={() => setMarkPaidId(payment.id)}
                                  >
                                    <Check className="h-3 w-3 mr-1" />
                                    Pagar
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-destructive"
                                  onClick={() => deletePayment.mutate(payment.id)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}

                  {/* Contract Actions */}
                  <div className="flex justify-end mt-4 pt-4 border-t">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setDeleteContractId(contract.id)}
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Eliminar Contrato
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}

      {/* New Contract Dialog */}
      <Dialog open={newContractOpen} onOpenChange={setNewContractOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo Contrato para {clientName}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!contractForm.serviceDescription.trim()) {
                toast.error("Describa el servicio contratado");
                return;
              }
              createContract.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Servicio Contratado *</Label>
              <Input
                value={contractForm.serviceDescription}
                onChange={(e) =>
                  setContractForm((prev) => ({
                    ...prev,
                    serviceDescription: e.target.value,
                  }))
                }
                placeholder="Ej: Representación en proceso ejecutivo"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valor del Contrato</Label>
                <Input
                  type="number"
                  value={contractForm.contractValue}
                  onChange={(e) =>
                    setContractForm((prev) => ({
                      ...prev,
                      contractValue: e.target.value,
                    }))
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Modalidad de Pago</Label>
                <Select
                  value={contractForm.paymentModality}
                  onValueChange={(v) =>
                    setContractForm((prev) => ({ ...prev, paymentModality: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_MODALITIES.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Fecha del Contrato</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(contractForm.contractDate, "dd/MM/yyyy", { locale: es })}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar
                    mode="single"
                    selected={contractForm.contractDate}
                    onSelect={(d) =>
                      d && setContractForm((prev) => ({ ...prev, contractDate: d }))
                    }
                    locale={es}
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Textarea
                value={contractForm.notes}
                onChange={(e) =>
                  setContractForm((prev) => ({ ...prev, notes: e.target.value }))
                }
                placeholder="Notas adicionales..."
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewContractOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createContract.isPending}>
                {createContract.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Crear Contrato
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Payment Dialog */}
      <Dialog
        open={!!newPaymentOpen}
        onOpenChange={(open) => !open && setNewPaymentOpen(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar Pago / Hito</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!paymentForm.description.trim()) {
                toast.error("Describa el pago o hito");
                return;
              }
              if (newPaymentOpen) {
                createPayment.mutate(newPaymentOpen);
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Descripción *</Label>
              <Input
                value={paymentForm.description}
                onChange={(e) =>
                  setPaymentForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="Ej: Anticipo, Primera cuota, Audiencia inicial..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Monto</Label>
                <Input
                  type="number"
                  value={paymentForm.amount}
                  onChange={(e) =>
                    setPaymentForm((prev) => ({ ...prev, amount: e.target.value }))
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Fecha de Vencimiento</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start",
                        !paymentForm.dueDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {paymentForm.dueDate
                        ? format(paymentForm.dueDate, "dd/MM/yyyy", { locale: es })
                        : "Seleccionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={paymentForm.dueDate}
                      onSelect={(d) =>
                        setPaymentForm((prev) => ({ ...prev, dueDate: d }))
                      }
                      locale={es}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewPaymentOpen(null)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createPayment.isPending}>
                {createPayment.isPending && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Agregar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Mark as Paid Confirmation */}
      <AlertDialog
        open={!!markPaidId}
        onOpenChange={(open) => !open && setMarkPaidId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Registrar pago?</AlertDialogTitle>
            <AlertDialogDescription>
              Se registrará este pago como recibido con fecha de hoy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => markPaidId && markAsPaid.mutate(markPaidId)}
              className="bg-green-600 hover:bg-green-700"
            >
              Confirmar Pago
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Contract Confirmation */}
      <AlertDialog
        open={!!deleteContractId}
        onOpenChange={(open) => !open && setDeleteContractId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar contrato?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminarán también todos los pagos/hitos asociados a este contrato.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteContractId && deleteContract.mutate(deleteContractId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
